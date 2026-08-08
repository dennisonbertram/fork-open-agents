import { describe, expect, test } from "bun:test";

/**
 * Executable half of `docs/process/guard-integrity.md`.
 *
 * A guard is only as good as its inputs. This repo has shipped guards that
 * passed their own unit tests and did nothing in production because a variable
 * they read was never delivered:
 *
 * - stripped by Turbo's strict env allowlist, so the guard failed open in every
 *   real build (#1167)
 * - absent from `.env.example`, so it was unarmed on every fresh checkout
 *
 * Those are configuration failures, and configuration is what unit tests skip.
 * This file asserts the delivery path for the migration guard's inputs instead
 * of the guard's logic, which is covered in `migration-target-guard.test.ts`.
 *
 * The expected set is derived from `migrate.ts` itself rather than hardcoded, so
 * adding a `process.env` read there fails this test until the value is actually
 * wired through.
 */

const REPO_ROOT = new URL("../../../../", import.meta.url);
const MIGRATE_ENTRY = new URL("apps/web/lib/db/migrate.ts", REPO_ROOT);
const TURBO_CONFIG = new URL("turbo.json", REPO_ROOT);
const ENV_EXAMPLE = new URL("apps/web/.env.example", REPO_ROOT);

/**
 * Variables the guard needs supplied per-checkout to be armed at all.
 *
 * `POSTGRES_URL` is excluded deliberately: it is the target being guarded, is
 * already present in `.env.example`, and its absence disables migrations
 * outright rather than silently weakening the guard. `VERCEL_ENV` is excluded
 * because the platform injects it; a developer never sets it by hand.
 */
const MUST_BE_IN_ENV_EXAMPLE = ["PRODUCTION_DB_HOST"];

type TurboConfig = {
  tasks?: Record<string, { env?: string[] }>;
  pipeline?: Record<string, { env?: string[] }>;
};

async function migrationEnvReads(): Promise<string[]> {
  const source = await Bun.file(MIGRATE_ENTRY).text();
  const reads = source.matchAll(/process\.env\.([A-Z0-9_]+)/g);
  return [...new Set([...reads].map((match) => match[1] as string))];
}

async function turboBuildEnv(): Promise<string[]> {
  const config = (await Bun.file(TURBO_CONFIG).json()) as TurboConfig;
  const tasks = config.tasks ?? config.pipeline ?? {};
  return tasks.build?.env ?? [];
}

async function envExampleKeys(): Promise<string[]> {
  const source = await Bun.file(ENV_EXAMPLE).text();
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0] as string);
}

describe("guard config coverage", () => {
  test("turbo delivers every variable the migration entry point reads", async () => {
    const declared = new Set(await turboBuildEnv());
    const undelivered = (await migrationEnvReads()).filter(
      (name) => !declared.has(name),
    );

    // Failure means the guard reads something the real build never supplies —
    // it will fail open, or misread its own environment, in production.
    expect(undelivered).toEqual([]);
  });

  test.each(MUST_BE_IN_ENV_EXAMPLE)(
    "%s is in .env.example so a fresh checkout arms the guard",
    async (name) => {
      expect(await envExampleKeys()).toContain(name);
    },
  );

  test("the guard's fail-open default is documented where it is defined", async () => {
    const source = await Bun.file(
      new URL("apps/web/lib/db/migration-target-guard.ts", REPO_ROOT),
    ).text();

    // Fail-open is a deliberate choice here — migrations gate every build, so
    // refusing when merely unconfigured would block all deploys. An
    // undocumented fail-open reads as a bug to the next person and invites a
    // "fix" that causes an outage.
    expect(source).toContain("FAILS OPEN");
  });
});
