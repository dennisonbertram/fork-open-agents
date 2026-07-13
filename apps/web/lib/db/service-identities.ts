import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { accounts } from "./schema";

export const GITHUB_APP_SERVICE_PROVIDER = "github-app-service";

export interface GitHubAppServiceRepoGrant {
  repositoryId: number;
}

function normalizeRepo(owner: string, repo: string): string | null {
  const value = `${owner.trim()}/${repo.trim()}`.toLowerCase();
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value) ? value : null;
}

function parseRepositoryId(scope: string | null): number | null {
  const match = /^repository_id:(\d+)$/.exec(scope ?? "");
  if (!match) {
    return null;
  }
  const repositoryId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(repositoryId) && repositoryId > 0
    ? repositoryId
    : null;
}

export async function getGitHubAppServiceRepoGrant(
  userId: string,
  owner: string,
  repo: string,
): Promise<GitHubAppServiceRepoGrant | null> {
  const accountId = normalizeRepo(owner, repo);
  if (!accountId) {
    return null;
  }

  const [grant] = await db
    .select({ scope: accounts.scope })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, GITHUB_APP_SERVICE_PROVIDER),
        eq(accounts.accountId, accountId),
      ),
    )
    .limit(1);

  const repositoryId = parseRepositoryId(grant?.scope ?? null);
  return repositoryId ? { repositoryId } : null;
}
