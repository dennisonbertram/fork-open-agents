import "server-only";

import { listAppInstallationRepositories } from "@/lib/github/repos";
import type { BackgroundAgentPermissions } from "@/lib/db/schema";

export type WriteScopeResolution =
  | { ok: true; repositoryIds: number[] }
  | { ok: false; errorKind: "write_scope_denied"; reason: string };

// GitHub's own installation-token mint accepts up to 500 repository_ids, but
// this codebase always resolves "all repos"/"repo_list" against a bounded
// enumeration rather than trusting an unrestricted mint. 100 mirrors the max
// page size already enforced by listAppInstallationRepositories.
const ENUMERATION_LIMIT = 100;

function dedupeSorted(ids: number[]): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

/**
 * Resolves a background agent's persisted GitHub write-scope selection
 * (this_repo / all_repos / repo_list) to an explicit, bounded, non-empty list
 * of numeric repo IDs — always including the run's home repo — right before
 * the write-scoped installation token is minted.
 *
 * NEVER returns an empty repositoryIds list and NEVER signals to the caller
 * that repository_ids should be omitted from the mint call: every branch
 * below resolves to a concrete list or an explicit denial.
 *
 * The `all_repos` mode is gated on `repositorySelection === "all"` at call
 * time (not cached from save time) — callers MUST pass the installation's
 * CURRENT repositorySelection (re-fetched by verifyRepoAccess on every run),
 * so an installer narrowing the installation after an agent was configured
 * with "all repos" fails the run instead of silently narrowing scope.
 */
export async function resolveWriteScopeRepositoryIds(params: {
  github: BackgroundAgentPermissions["github"];
  homeRepositoryId: number;
  installationId: number;
  repositorySelection: "all" | "selected";
}): Promise<WriteScopeResolution> {
  const mode = params.github?.writeScopeMode ?? "this_repo";

  if (mode === "this_repo") {
    return { ok: true, repositoryIds: [params.homeRepositoryId] };
  }

  if (mode === "all_repos") {
    if (params.repositorySelection !== "all") {
      return {
        ok: false,
        errorKind: "write_scope_denied",
        reason:
          "This agent is configured to write to all repos, but the GitHub App installation is currently scoped to selected repos, not all repos. Narrow the agent's write scope to this repo or specific repos, or update the installation's repository access on GitHub.",
      };
    }

    const accessibleRepos = await listAppInstallationRepositories({
      installationId: params.installationId,
      limit: ENUMERATION_LIMIT,
    });

    return {
      ok: true,
      repositoryIds: dedupeSorted([
        params.homeRepositoryId,
        ...accessibleRepos.map((repo) => repo.id),
      ]),
    };
  }

  // repo_list
  const requestedFullNames = params.github?.writeScopeRepos ?? [];
  if (requestedFullNames.length === 0) {
    return { ok: true, repositoryIds: [params.homeRepositoryId] };
  }

  const accessibleRepos = await listAppInstallationRepositories({
    installationId: params.installationId,
    limit: ENUMERATION_LIMIT,
  });
  const accessibleIdByFullName = new Map(
    accessibleRepos.map((repo) => [repo.full_name, repo.id]),
  );

  const resolvedIds: number[] = [params.homeRepositoryId];
  for (const fullName of requestedFullNames) {
    const id = accessibleIdByFullName.get(fullName);
    if (id === undefined) {
      return {
        ok: false,
        errorKind: "write_scope_denied",
        reason: `Requested write-scope repo "${fullName}" is not accessible to this GitHub App installation.`,
      };
    }
    resolvedIds.push(id);
  }

  return { ok: true, repositoryIds: dedupeSorted(resolvedIds) };
}
