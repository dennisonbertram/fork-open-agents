/**
 * Dev-only: seed a githubInstallations row for the signed-in user.
 *
 * WHY: In production, the `github_installations` table is populated by the
 * GitHub App "installation" webhook (installation created → upsertInstallation).
 * GitHub cannot deliver webhooks to localhost, so local dev never gets the row,
 * and the `syncUserInstallations` fallback 403s because a standalone OAuth App
 * token cannot call GitHub's `/user/installations` endpoint ("You must
 * authenticate with an access token authorized to a GitHub App").
 *
 * This script bypasses both: it authenticates as the GitHub App itself
 * (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, no user token) via getAppOctokit(),
 * lists the App's real installations via GET /app/installations, finds the
 * target account, and upserts the same row the webhook would have written.
 *
 * Prereqs:
 *   - Signed-in user with a linked GitHub account (Connect GitHub in the UI
 *     first — this script reads that user from the `accounts` table).
 *   - The GitHub App installed on the target account/repo (install at
 *     https://github.com/apps/<slug>/installations/new if missing).
 *
 * Usage:
 *   SEED_INSTALL_LOGIN=dennisonbertram \
 *   bun run --cwd apps/web background-agents:seed-installation
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { upsertInstallation } from "@/lib/db/installations";
import { getAppOctokit } from "@/lib/github/app";

const appRoot = join(import.meta.dirname, "..");
for (const filename of [".env.local", ".env"]) {
  const envPath = join(appRoot, filename);
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

const TARGET_LOGIN = (process.env.SEED_INSTALL_LOGIN ?? "dennisonbertram")
  .trim()
  .toLowerCase();

async function main() {
  // 1. Find the user who linked GitHub (the just-connected account).
  const [acct] = await db
    .select({ userId: accounts.userId, accountId: accounts.accountId })
    .from(accounts)
    .where(eq(accounts.providerId, "github"))
    .orderBy(desc(accounts.updatedAt))
    .limit(1);

  if (!acct) {
    console.error(
      "No GitHub-linked account found in the DB. Sign in and Connect GitHub first, then re-run.",
    );
    process.exit(1);
  }

  // 2. Authenticate as the GitHub App (JWT, no user token) and list its
  //    real installations.
  const octokit = getAppOctokit();
  const installations = (await octokit.paginate("GET /app/installations", {
    per_page: 100,
  })) as Array<{
    id: number;
    html_url: string | null;
    repository_selection: "all" | "selected";
    account: { login: string; type: string } | null;
  }>;

  const inst = installations.find(
    (i) => i.account?.login?.toLowerCase() === TARGET_LOGIN,
  );

  if (!inst || !inst.account) {
    console.error(
      `GitHub App has no installation for "${TARGET_LOGIN}". Install it at https://github.com/apps/${process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "open-agents-dennison"}/installations/new and re-run.`,
    );
    console.error(
      `Available installations: ${installations.map((i) => i.account?.login ?? "(unknown)").join(", ") || "(none)"}`,
    );
    process.exit(1);
  }

  const accountType: "User" | "Organization" =
    inst.account.type === "Organization" ? "Organization" : "User";
  const repositorySelection: "all" | "selected" =
    inst.repository_selection === "all" ? "all" : "selected";

  // 3. Upsert the same row the install webhook would have written.
  const row = await upsertInstallation({
    userId: acct.userId,
    installationId: inst.id,
    accountLogin: inst.account.login,
    accountType,
    repositorySelection,
    installationUrl: inst.html_url ?? null,
  });

  console.log(
    `Seeded githubInstallations: userId=${acct.userId} login=${inst.account.login} installationId=${inst.id} type=${accountType} selection=${repositorySelection} rowId=${row.id}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Seed installation failed: ${message}`);
  process.exit(1);
});
