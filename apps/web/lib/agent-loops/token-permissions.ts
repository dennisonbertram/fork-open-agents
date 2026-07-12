/**
 * token-permissions.ts — map an agent's declared GitHub permissions
 * (BackgroundAgentPermissions, camelCase) to the GitHub App installation-token
 * permission shape (snake_case) used by mintInstallationToken.
 *
 * `contents: "write"` is always included: the loop step clones the repo and the
 * loop auto-commits/pushes, so the clone token needs push access regardless of
 * the declared scopes. The declared scopes ADD capability (e.g. issues:write so
 * an agent can `gh issue create`, pull_requests:write so it can open PRs).
 *
 * Pure — no I/O. Unit-tested.
 */

import type { BackgroundAgentPermissions } from "@/lib/db/schema";
import type { GitHubInstallationTokenPermissions } from "@/lib/github/app";

export function permissionsToInstallationToken(
  permissions: BackgroundAgentPermissions | undefined,
): GitHubInstallationTokenPermissions {
  // Baseline: clone + push always need contents:write.
  const token: GitHubInstallationTokenPermissions = { contents: "write" };

  const gh = permissions?.github;
  if (!gh) return token;

  if (gh.pullRequests) token.pull_requests = gh.pullRequests;
  if (gh.issues) token.issues = gh.issues;
  if (gh.deployments) token.deployments = gh.deployments;
  if (gh.statuses) token.statuses = gh.statuses;
  if (gh.checks) token.checks = gh.checks;
  // contents stays "write" (push baseline) even if declared "read".

  return token;
}

/**
 * Effective permissions for a loop step: the step's own permissions if set,
 * otherwise the loop-level permissions (loop = default, step may override).
 */
export function effectiveStepPermissions(
  stepPermissions: BackgroundAgentPermissions | undefined,
  loopPermissions: BackgroundAgentPermissions | undefined,
): BackgroundAgentPermissions | undefined {
  if (stepPermissions && Object.keys(stepPermissions.github ?? {}).length > 0) {
    return stepPermissions;
  }
  return loopPermissions;
}

type GithubPermissions = NonNullable<BackgroundAgentPermissions["github"]>;

/** Frozen request intersected with the current live allowance, field by field. */
export function intersectStepPermissions(
  requested: BackgroundAgentPermissions | undefined,
  live: BackgroundAgentPermissions | undefined,
): BackgroundAgentPermissions | undefined {
  const requestedGithub = requested?.github;
  const liveGithub = live?.github;
  if (!requestedGithub) return undefined;
  const github: Partial<Record<keyof GithubPermissions, "read" | "write">> = {};
  for (const key of Object.keys(requestedGithub) as Array<
    keyof GithubPermissions
  >) {
    const requestedValue = requestedGithub[key];
    const liveValue = liveGithub?.[key];
    if (!requestedValue || !liveValue) continue;
    github[key] =
      requestedValue === "read" || liveValue === "read" ? "read" : "write";
  }
  return Object.keys(github).length > 0
    ? { github: github as GithubPermissions }
    : undefined;
}

/** null means the runtime default set; arrays are explicit allowlists. */
export function intersectBuiltinToolNames(
  requested: string[] | null,
  live: string[] | null,
): string[] | null {
  if (requested === null) return live;
  if (live === null) return requested;
  const liveNames = new Set(live);
  return requested.filter((name) => liveNames.has(name));
}

export function intersectComposioToolkitSlugs(
  requested: string[],
  live: string[],
): string[] {
  const liveSlugs = new Set(live);
  return requested.filter((slug) => liveSlugs.has(slug));
}
