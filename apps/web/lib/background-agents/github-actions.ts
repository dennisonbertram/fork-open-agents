/**
 * Canonical GitHub tool-action set for background agents (#740).
 *
 * This module MUST stay free of server-only imports (no "server-only"
 * pragma, no server-only dependencies) — it is imported from schema.ts,
 * types.ts, agent-spec.ts, and eventually client UI components, all of
 * which must stay safe to bundle for the client.
 */

export const GITHUB_TOOL_ACTIONS = [
  "open_pull_request",
  "comment_on_pr_or_issue",
  "approve_pull_request",
  "request_changes",
  "merge_pull_request",
  "push",
  "delete_branch",
] as const;

export type GitHubToolAction = (typeof GITHUB_TOOL_ACTIONS)[number];

/**
 * Default action set for newly created agents, and the migrated equivalent
 * of legacy outputMode:"ready_pr" agents (see resolveGitHubToolConfig).
 */
export const DEFAULT_ENABLED_ACTIONS: GitHubToolAction[] = [
  "open_pull_request",
  "comment_on_pr_or_issue",
];

/**
 * Every action that mutates repo/PR state via a write-scoped installation
 * token. Used to decide whether an agent needs write-scope resolution at
 * all (enabledActions.length > 0 based checks live alongside this set).
 */
export const WRITE_ACTIONS: ReadonlySet<GitHubToolAction> = new Set([
  "open_pull_request",
  "approve_pull_request",
  "request_changes",
  "merge_pull_request",
  "push",
  "delete_branch",
]);

/**
 * Actions that are irreversible or high-blast-radius. Used by the UI to
 * render an "Irreversible" caption — this is a label only, it never
 * disables the toggle or narrows the write-scope mechanism.
 */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<GitHubToolAction> = new Set([
  "merge_pull_request",
  "push",
  "delete_branch",
]);

/**
 * Structural shape resolveGitHubToolConfig needs from a persisted agent.
 * Deliberately NOT imported from schema.ts/agent-spec.ts (both of which
 * already import types from this module) — a structural type here avoids a
 * circular dependency while still accepting the real BackgroundAgentPermissions
 * / BackgroundAgent.permissions shapes, which are structural supersets.
 */
type ResolvableGitHubToolAgent = {
  outputMode?: string | null;
  permissions?: {
    github?: {
      enabledActions?: GitHubToolAction[];
      requireCiGreenToMerge?: boolean;
    } | null;
  } | null;
};

export type ResolvedGitHubToolConfig = {
  enabledActions: GitHubToolAction[];
  requireCiGreenToMerge: boolean;
};

/**
 * Single source of truth for deriving the effective GitHub tool-action set
 * for a background agent (#740). Guarantees byte-identical behavior for
 * every pre-#740 agent:
 *
 * - If permissions.github.enabledActions is a defined array (even []), the
 *   agent is "new-model" — return it verbatim. This is keyed on
 *   Array.isArray, NOT truthiness, so an explicit [] (new-model, zero
 *   actions) is never confused with "absent" (legacy, derive from
 *   outputMode).
 * - Otherwise derive from the legacy outputMode: "ready_pr" migrates to the
 *   agreed default set (open_pull_request + comment_on_pr_or_issue, per
 *   product-owner-confirmed mapping — do not narrow this to just
 *   open_pull_request). Every other outputMode (including "none", absent,
 *   "comment", "issue", "notification") migrates to zero actions —
 *   report-only agents gain no write actions.
 * - requireCiGreenToMerge defaults to true in every case unless the
 *   new-model agent explicitly set it to false.
 */
export function resolveGitHubToolConfig(
  agent: ResolvableGitHubToolAgent,
): ResolvedGitHubToolConfig {
  const githubPermissions = agent.permissions?.github;

  if (Array.isArray(githubPermissions?.enabledActions)) {
    return {
      enabledActions: githubPermissions.enabledActions,
      requireCiGreenToMerge: githubPermissions.requireCiGreenToMerge ?? true,
    };
  }

  if (agent.outputMode === "ready_pr") {
    return {
      enabledActions: [...DEFAULT_ENABLED_ACTIONS],
      requireCiGreenToMerge: true,
    };
  }

  return { enabledActions: [], requireCiGreenToMerge: true };
}
