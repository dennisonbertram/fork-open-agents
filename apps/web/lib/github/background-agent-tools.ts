import "server-only";

import type { Sandbox } from "@open-agents/sandbox";
import type { Octokit } from "@octokit/rest";
import type { ToolSet } from "ai";
import {
  DESTRUCTIVE_ACTIONS,
  type GitHubToolAction,
} from "@/lib/background-agents/github-actions";
import type { BackgroundAgentTriggerKind } from "@/lib/background-agents/types";
import {
  type GitHubInstallationTokenPermissions,
  withScopedInstallationOctokit,
} from "@/lib/github/app";

/**
 * Native GitHub tool set for BACKGROUND AGENTS (#740).
 *
 * Mirrors the STYLE of apps/web/lib/github/tools.ts (AI SDK tool() builders,
 * per-call withScopedInstallationOctokit token minting), but is scoped to a
 * background agent's write-scope repo-ID list (resolveWriteScopeRepositoryIds,
 * #736) instead of the interactive chat session's single bound repo.
 *
 * This module is server-only (installation tokens, Sandbox exec) and must
 * only ever be imported from the background-agent executor — never from
 * schema/types/UI (unlike apps/web/lib/background-agents/github-actions.ts,
 * which is deliberately client-safe).
 */

// ── Typed error union ─────────────────────────────────────────────────────────

/**
 * Discriminated error kinds every action tool's execute() can return. Grows
 * as STEPs 4-8 add actions (e.g. "merge_blocked_ci_not_green" for the merge
 * tool's CI gate, "not_fast_forward" for the push tool, "protected_branch"
 * for delete_branch refusing to delete ctx.baseBranch).
 */
export type GitHubActionErrorKind =
  | "merge_blocked_ci_not_green"
  | "check_command_failed"
  | "not_fast_forward"
  | "pr_not_found"
  | "protected_branch"
  | "no_changes"
  | "access_error";

export type GitHubActionErrorResult = {
  ok: false;
  errorKind: GitHubActionErrorKind;
  error: string;
};

/**
 * Shapes a failed tool result consistently across every action tool's
 * execute(). Every action tool returns `{ ok:true; ... } | GitHubActionErrorResult`.
 */
export function buildGitHubActionError(
  errorKind: GitHubActionErrorKind,
  error: string,
): GitHubActionErrorResult {
  return { ok: false, errorKind, error };
}

// ── Context ────────────────────────────────────────────────────────────────────

/**
 * Minimal event/output shape a tool execute() needs to report through.
 * Deliberately narrower than store.ts's RecordEventInput/RecordOutputInput
 * (those aren't exported) — callers (the executor) pre-bind runId/agentId/
 * userId/workflowRunId/requestId/sandboxName once per run and hand this
 * module only the per-call delta.
 */
export type BackgroundAgentGitHubEventInput = {
  eventName: string;
  status:
    | "started"
    | "running"
    | "succeeded"
    | "failed"
    | "blocked"
    | "skipped"
    | "info";
  level?: "info" | "warn" | "error";
  summary?: string | null;
  errorKind?: string | null;
  payload?: Record<string, unknown>;
};

export type BackgroundAgentGitHubOutputInput = {
  kind: "comment" | "ready_pr" | "issue" | "notification" | "none";
  status: "pending" | "created" | "failed" | "skipped";
  url?: string | null;
  prNumber?: number | null;
  payload?: Record<string, unknown>;
};

/**
 * Shared context passed to every background-agent GitHub action tool
 * builder. ctx.repositoryIds MUST be the already-resolved bounded list from
 * resolveWriteScopeRepositoryIds (#736) — never a single-repo list — so a
 * multi-repo write scope is never silently narrowed by a tool call.
 */
export type BackgroundAgentGitHubToolContext = {
  installationId: number;
  repositoryIds: number[];
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  userId: string;
  agentName: string;
  runId: string;
  agentId: string | null;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  triggerKind: BackgroundAgentTriggerKind;
  checkCommand: string | null;
  sandbox: Sandbox;
  enabledActions: GitHubToolAction[];
  requireCiGreenToMerge: boolean;
  recordEvent: (event: BackgroundAgentGitHubEventInput) => Promise<void>;
  recordOutput: (output: BackgroundAgentGitHubOutputInput) => Promise<void>;
};

// ── Per-call token helper ─────────────────────────────────────────────────────

/**
 * Per-call mint-and-revoke installation token wrapper for background-agent
 * GitHub action tools. Every tool execute() (except merge_pull_request,
 * STEP-7, which manually spans mint/revoke across two API calls with a
 * single token) goes through this so no standing credential exists across a
 * turn — withScopedInstallationOctokit mints, runs, and revokes in a finally
 * (see apps/web/lib/github/app.ts).
 */
async function withPerCallInstallationOctokit<T>(
  ctx: BackgroundAgentGitHubToolContext,
  permissions: GitHubInstallationTokenPermissions,
  operation: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  return withScopedInstallationOctokit({
    installationId: ctx.installationId,
    repositoryIds: ctx.repositoryIds,
    permissions,
    operation,
  });
}

// ── Observability helper ──────────────────────────────────────────────────────

/**
 * Emits a `background-agent.github.<action>` event with severity scaling:
 * destructive actions (merge_pull_request, push, delete_branch) are
 * expected to carry richer attribution in `payload` from the caller (CI
 * status at merge time, forced flag, target ref, sha); low-risk actions
 * (e.g. comment_on_pr_or_issue) carry minimal attribution. This helper only
 * adds the standard eventName/status shape and the severity classification
 * — callers supply the action-specific attribution fields.
 */
async function recordActionEvent(
  ctx: BackgroundAgentGitHubToolContext,
  action: GitHubToolAction,
  status: BackgroundAgentGitHubEventInput["status"],
  payload: Record<string, unknown> = {},
): Promise<void> {
  const severity = DESTRUCTIVE_ACTIONS.has(action) ? "high" : "low";
  await ctx.recordEvent({
    eventName: `background-agent.github.${action}`,
    status,
    summary: `${action} ${status}`,
    payload: { ...payload, severity },
  });
}

// Re-exported so STEPs 4-8 (implemented in this same file) and this file's
// own tests can reach the per-call token and observability helpers without
// a second module hop.
export { withPerCallInstallationOctokit, recordActionEvent };

// ── Resolver ───────────────────────────────────────────────────────────────────

/**
 * Resolves the ToolSet of native GitHub action tools for a background agent
 * run, one entry per action in ctx.enabledActions. Actions without an
 * implemented tool builder yet are simply absent from the result — this
 * keeps the resolver forward-compatible with actions enabled in config
 * before their tool implementation ships (STEPs 4-8 add one case each).
 */
export function resolveGitHubActionToolsForBackgroundAgent(
  ctx: BackgroundAgentGitHubToolContext,
): ToolSet {
  const tools: ToolSet = {};

  for (const action of ctx.enabledActions) {
    switch (action) {
      // Tool builders are added incrementally in STEPs 4-8:
      //   "comment_on_pr_or_issue" -> github_comment_on_pr_or_issue (STEP-4)
      //   "open_pull_request"      -> github_open_pull_request (STEP-5)
      //   "approve_pull_request"   -> github_approve_pull_request (STEP-6)
      //   "request_changes"        -> github_request_changes (STEP-6)
      //   "merge_pull_request"     -> github_merge_pull_request (STEP-7)
      //   "push"                   -> github_push (STEP-8)
      //   "delete_branch"          -> github_delete_branch (STEP-8)
      default:
        break;
    }
  }

  return tools;
}
