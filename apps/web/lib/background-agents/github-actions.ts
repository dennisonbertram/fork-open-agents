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
