import "server-only";

import { stageAll, type Sandbox } from "@open-agents/sandbox";
import type { Octokit } from "@octokit/rest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  DESTRUCTIVE_ACTIONS,
  type GitHubToolAction,
} from "@/lib/background-agents/github-actions";
import {
  performReadyPullRequest,
  prepareReadyPullRequestBranch,
} from "@/lib/background-agents/ready-pr-runner";
import { buildBackgroundBranchName } from "@/lib/background-agents/ready-pr";
import type { BackgroundAgentTriggerKind } from "@/lib/background-agents/types";
import {
  type GitHubInstallationTokenPermissions,
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
} from "@/lib/github/app";
import { buildCoAuthor, createCommit } from "@/lib/github/commit";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import {
  getMergeReadiness,
  type MergeReadiness,
  mergePullRequest,
} from "@/lib/github/pulls";

const DEFAULT_OPEN_PR_CHECK_TIMEOUT_MS = 120_000;

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
  | "merge_conflict"
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
  /** Home repo ID — the commit/PR target. Always a member of repositoryIds. */
  repositoryId: number;
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

// ── comment_on_pr_or_issue action (STEP-4, closes #738) ────────────────────────

const commentInputSchema = z.object({
  number: z
    .number()
    .int()
    .positive()
    .describe("The issue or pull request number to comment on."),
  body: z.string().min(1).describe("The comment text in Markdown."),
});

type CommentOnPrOrIssueOutput =
  | { ok: true; commentId: number; url: string }
  | GitHubActionErrorResult;

/**
 * Posts a comment on either an issue OR a pull request via the shared
 * issues.createComment endpoint (GitHub treats every PR as an issue for
 * commenting purposes). Deliberately does NOT call assertNotPullRequest
 * (unlike apps/web/lib/github/tools.ts's issue-only buildCommentOnIssueTool)
 * — this tool intentionally targets both PRs and issues, so a future reader
 * should not "fix" this by adding the guard back.
 */
function buildCommentTool(ctx: BackgroundAgentGitHubToolContext) {
  return tool({
    description: `Post a comment on an issue or pull request in ${ctx.repoOwner}/${ctx.repoName}.
This tool acts as the GitHub App via a per-call installation token scoped to issues:write, bounded to the agent's write scope.`,
    inputSchema: commentInputSchema,
    execute: async ({ number, body }): Promise<CommentOnPrOrIssueOutput> => {
      try {
        const data = await withPerCallInstallationOctokit(
          ctx,
          { issues: "write" },
          async (octokit) => {
            const response = await octokit.rest.issues.createComment({
              owner: ctx.repoOwner,
              repo: ctx.repoName,
              issue_number: number,
              body,
            });
            return response.data;
          },
        );

        await recordActionEvent(ctx, "comment_on_pr_or_issue", "succeeded", {
          number,
          commentId: data.id,
        });

        return { ok: true, commentId: data.id, url: data.html_url };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, "comment_on_pr_or_issue", "failed", {
          number,
          error: message,
        });
        return buildGitHubActionError("access_error", message);
      }
    },
  });
}

// ── open_pull_request action (STEP-5) ───────────────────────────────────────────

const openPullRequestInputSchema = z.object({
  title: z
    .string()
    .optional()
    .describe(
      "Optional pull request title override. Defaults to a generated title based on the agent name.",
    ),
  body: z
    .string()
    .optional()
    .describe(
      "Optional pull request body override. Defaults to a generated body with run evidence.",
    ),
});

type OpenPullRequestOutput =
  | { ok: true; prUrl: string; prNumber: number | null }
  | GitHubActionErrorResult;

/**
 * Opens a pull request for the sandbox's currently staged/uncommitted
 * changes: checks out the agent's branch, commits via the verified GitHub
 * App commit path (performReadyPullRequest, ready-pr-runner.ts), and opens
 * the PR with the user's OAuth token. If ctx.checkCommand is configured, it
 * is run and enforced INSIDE this execute() — a failing check blocks PR
 * creation entirely, matching today's deterministic executor-level gate
 * (never downgraded to a prompt-only instruction).
 */
function buildOpenPullRequestTool(ctx: BackgroundAgentGitHubToolContext) {
  return tool({
    description: `Commit the current sandbox changes and open a pull request against ${ctx.baseBranch} in ${ctx.repoOwner}/${ctx.repoName}.
Call this only after your work is complete and verified. ${
      ctx.checkCommand?.trim()
        ? `The required check command "${ctx.checkCommand.trim()}" is run and must pass before the PR is opened.`
        : "No required check command is configured."
    }`,
    inputSchema: openPullRequestInputSchema,
    execute: async ({ title, body }): Promise<OpenPullRequestOutput> => {
      const checkCommand = ctx.checkCommand?.trim();
      if (checkCommand) {
        const checkResult = await ctx.sandbox.exec(
          checkCommand,
          ctx.sandbox.workingDirectory,
          DEFAULT_OPEN_PR_CHECK_TIMEOUT_MS,
        );
        if (!checkResult.success) {
          await recordActionEvent(ctx, "open_pull_request", "failed", {
            reason: "check_command_failed",
            checkCommand,
          });
          return buildGitHubActionError(
            "check_command_failed",
            `Required check command failed: ${checkCommand}`,
          );
        }
      }

      const branchName = buildBackgroundBranchName({
        agentName: ctx.agentName,
        runId: ctx.runId,
      });

      try {
        await prepareReadyPullRequestBranch({
          sandbox: ctx.sandbox,
          branchName,
          recordEvent: ctx.recordEvent,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, "open_pull_request", "failed", {
          reason: message,
        });
        return buildGitHubActionError("access_error", message);
      }

      const result = await performReadyPullRequest({
        runId: ctx.runId,
        agentId: ctx.agentId,
        userId: ctx.userId,
        workflowRunId: ctx.workflowRunId,
        requestId: ctx.requestId,
        sandboxName: ctx.sandboxName,
        sandbox: ctx.sandbox,
        agentName: ctx.agentName,
        repoOwner: ctx.repoOwner,
        repoName: ctx.repoName,
        branchName,
        baseBranch: ctx.baseBranch,
        installationId: ctx.installationId,
        repositoryId: ctx.repositoryId,
        repositoryIds: ctx.repositoryIds,
        checkCommand: ctx.checkCommand,
        triggerKind: ctx.triggerKind,
        title,
        body,
        recordEvent: ctx.recordEvent,
        recordOutput: ctx.recordOutput,
      });

      if (!result.success) {
        const errorKind: GitHubActionErrorKind =
          result.error === "Background agent completed without file changes."
            ? "no_changes"
            : "access_error";
        await recordActionEvent(ctx, "open_pull_request", "failed", {
          reason: result.error,
        });
        return buildGitHubActionError(
          errorKind,
          result.error ?? "Failed to open pull request.",
        );
      }

      await recordActionEvent(ctx, "open_pull_request", "succeeded", {
        prNumber: result.prNumber ?? null,
        url: result.prUrl,
      });

      return {
        ok: true,
        prUrl: result.prUrl as string,
        prNumber: result.prNumber ?? null,
      };
    },
  });
}

// ── approve_pull_request / request_changes actions (STEP-6) ─────────────────────

const approveInputSchema = z.object({
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("The pull request number to review."),
  body: z
    .string()
    .optional()
    .describe("Optional review comment explaining the approval."),
});

const requestChangesInputSchema = z.object({
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("The pull request number to review."),
  body: z
    .string()
    .min(1)
    .describe(
      "Required review comment explaining what changes are needed (GitHub rejects REQUEST_CHANGES reviews without a body).",
    ),
});

type ReviewToolOutput =
  | { ok: true; reviewId: number; state: string }
  | GitHubActionErrorResult;

/**
 * Builds either the approve_pull_request or request_changes tool. Both wrap
 * octokit.rest.pulls.createReview with a per-call installation token scoped
 * to pull_requests:write (never issues:write — this is a PR review action,
 * not a comment). Note: the GitHub App installation cannot approve/request
 * changes on its OWN pull requests (a PR opened by the same App identity) —
 * this is a GitHub platform limitation, surfaced here only as an
 * observability/description note for operators to configure a distinct
 * reviewer identity when needed, never as a hard block in this tool.
 */
function buildReviewTool(
  ctx: BackgroundAgentGitHubToolContext,
  action: Extract<GitHubToolAction, "approve_pull_request" | "request_changes">,
  event: "APPROVE" | "REQUEST_CHANGES",
) {
  const inputSchema =
    event === "APPROVE" ? approveInputSchema : requestChangesInputSchema;

  return tool({
    description: `${
      event === "APPROVE" ? "Approve" : "Request changes on"
    } a pull request in ${ctx.repoOwner}/${ctx.repoName}.
This tool acts as the GitHub App via a per-call installation token scoped to pull_requests:write, bounded to the agent's write scope.
Note: GitHub does not allow an App installation to review its own pull requests — if this run opened the PR, this call will fail.`,
    inputSchema,
    execute: async ({
      prNumber,
      body,
    }: {
      prNumber: number;
      body?: string;
    }): Promise<ReviewToolOutput> => {
      try {
        const data = await withPerCallInstallationOctokit(
          ctx,
          { pull_requests: "write" },
          async (octokit) => {
            const response = await octokit.rest.pulls.createReview({
              owner: ctx.repoOwner,
              repo: ctx.repoName,
              pull_number: prNumber,
              event,
              body,
            });
            return response.data;
          },
        );

        await recordActionEvent(ctx, action, "succeeded", {
          prNumber,
          reviewId: data.id,
          event,
        });

        return { ok: true, reviewId: data.id, state: data.state };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, action, "failed", {
          prNumber,
          event,
          error: message,
        });
        return buildGitHubActionError("access_error", message);
      }
    },
  });
}

// ── merge_pull_request action (STEP-7) ───────────────────────────────────────

const mergeInputSchema = z.object({
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("The pull request number to merge."),
  mergeMethod: z
    .enum(["merge", "squash", "rebase"])
    .optional()
    .describe("Merge strategy. Defaults to squash."),
  commitTitle: z
    .string()
    .optional()
    .describe("Optional merge commit title override."),
  commitMessage: z
    .string()
    .optional()
    .describe("Optional merge commit message override."),
});

type MergeToolFailure = GitHubActionErrorResult & {
  checks?: MergeReadiness["checks"];
};

type MergePullRequestOutput = { ok: true; sha: string } | MergeToolFailure;

/**
 * Merges a pull request. Unlike every other action tool in this module, this
 * does NOT go through withPerCallInstallationOctokit — it manually mints a
 * SINGLE installation token that spans both the CI-readiness check and the
 * merge call itself, so only one token is minted (and revoked) per merge,
 * not two. The require-CI-green gate is enforced INSIDE this execute(): when
 * ctx.requireCiGreenToMerge is true, getMergeReadiness (pulls.ts, the
 * existing combined-status + check-runs + mergeable_state computation) is
 * consulted first and the merge is refused outright if it reports
 * `canMerge:false` — this never relies on the model to self-police. When the
 * gate is off, getMergeReadiness is never called and the merge proceeds
 * regardless of check state.
 */
function buildMergeTool(ctx: BackgroundAgentGitHubToolContext) {
  return tool({
    description: `Merge a pull request in ${ctx.repoOwner}/${ctx.repoName}. ${
      ctx.requireCiGreenToMerge
        ? "Required CI checks must be green before this call succeeds; the merge is blocked otherwise."
        : "CI checks are NOT required by this agent's configuration; the merge proceeds regardless of check state."
    }
This tool acts as the GitHub App via a single per-call installation token scoped to pull_requests:write and contents:write, bounded to the agent's write scope.`,
    inputSchema: mergeInputSchema,
    execute: async ({
      prNumber,
      mergeMethod,
      commitTitle,
      commitMessage,
    }): Promise<MergePullRequestOutput> => {
      let scoped: Awaited<ReturnType<typeof mintInstallationToken>>;
      try {
        scoped = await mintInstallationToken({
          installationId: ctx.installationId,
          repositoryIds: ctx.repositoryIds,
          // checks:read/statuses:read let getMergeReadiness's
          // checks.listForRef/getCombinedStatusForRef calls succeed instead
          // of 403ing (and being silently swallowed) — without these, the
          // CI-status-at-merge attribution in ciChecksSummary is always
          // zeroed out even though the mergeable_state gate itself still
          // works correctly off pulls.get.
          permissions: {
            pull_requests: "write",
            contents: "write",
            checks: "read",
            statuses: "read",
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, "merge_pull_request", "failed", {
          prNumber,
          mergeMethod: mergeMethod ?? null,
          requireCiGreenToMerge: ctx.requireCiGreenToMerge,
          error: message,
        });
        return buildGitHubActionError("access_error", message);
      }

      try {
        const repoUrl = `https://github.com/${ctx.repoOwner}/${ctx.repoName}`;
        let ciChecksSummary: MergeReadiness["checks"] | null = null;
        // Pins the merge to the exact head sha observed by the readiness
        // check (when one was performed), closing the TOCTOU window where a
        // commit landing between the check and the merge call below would
        // otherwise be merged un-vetted even with the CI-gate on. GitHub's
        // API itself rejects the merge (409, surfaced as merge_conflict) if
        // the branch has moved since.
        let expectedHeadSha: string | undefined;

        if (ctx.requireCiGreenToMerge) {
          const readiness = await getMergeReadiness({
            repoUrl,
            prNumber,
            token: scoped.token,
          });
          ciChecksSummary = readiness.checks;
          expectedHeadSha = readiness.pr?.headSha;

          if (!readiness.canMerge) {
            const reason =
              readiness.reasons.join("; ") ||
              "Pull request is not ready to merge.";
            await recordActionEvent(ctx, "merge_pull_request", "blocked", {
              prNumber,
              mergeMethod: mergeMethod ?? null,
              requireCiGreenToMerge: ctx.requireCiGreenToMerge,
              ciChecksSummary,
              mergedSha: null,
              reason,
            });
            return {
              ok: false,
              errorKind: "merge_blocked_ci_not_green",
              error: reason,
              checks: readiness.checks,
            };
          }
        }

        const merged = await mergePullRequest({
          repoUrl,
          prNumber,
          mergeMethod,
          commitTitle,
          commitMessage,
          token: scoped.token,
          ...(expectedHeadSha ? { expectedHeadSha } : {}),
        });

        if (!(merged.success && merged.sha)) {
          const errorKind: GitHubActionErrorKind =
            merged.statusCode === 409 ? "merge_conflict" : "access_error";
          const message = merged.error ?? "Failed to merge pull request.";
          await recordActionEvent(ctx, "merge_pull_request", "failed", {
            prNumber,
            mergeMethod: mergeMethod ?? null,
            requireCiGreenToMerge: ctx.requireCiGreenToMerge,
            ciChecksSummary,
            mergedSha: null,
            error: message,
          });
          return buildGitHubActionError(errorKind, message);
        }

        await recordActionEvent(ctx, "merge_pull_request", "succeeded", {
          prNumber,
          mergeMethod: mergeMethod ?? null,
          requireCiGreenToMerge: ctx.requireCiGreenToMerge,
          ciChecksSummary,
          mergedSha: merged.sha,
        });

        return { ok: true, sha: merged.sha };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, "merge_pull_request", "failed", {
          prNumber,
          mergeMethod: mergeMethod ?? null,
          requireCiGreenToMerge: ctx.requireCiGreenToMerge,
          error: message,
        });
        return buildGitHubActionError("access_error", message);
      } finally {
        await revokeInstallationToken(scoped.token);
      }
    },
  });
}

// ── push action (STEP-8) ──────────────────────────────────────────────────────

const REMOTE_BRANCH_CHANGED_ERROR =
  "Remote branch changed before commit could be created";

const pushInputSchema = z.object({
  branch: z
    .string()
    .min(1)
    .describe("The branch ref to push the sandbox's current changes to."),
  force: z
    .boolean()
    .default(false)
    .describe(
      "When true, bypasses the fast-forward staleness check and commits on top of the branch's current remote tip even if it moved since the sandbox last synced. Never applied implicitly — must be set explicitly.",
    ),
});

type PushToolOutput =
  | { ok: true; sha: string; forced: boolean }
  | GitHubActionErrorResult;

/**
 * Commits the sandbox's current changes onto an arbitrary branch ref via the
 * SAME verified GitHub App commit path used by open_pull_request
 * (buildCommitIntentFromSandbox -> createCommit inside a per-call
 * contents:write installation token), rather than a raw updateRef, so pushes
 * carry the same verified-commit guarantees.
 *
 * Non-force pushes forward the sandbox's captured expectedHeadSha through to
 * createCommit; if the remote branch has moved since (createCommit's own
 * staleness check), the push fails closed with 'not_fast_forward' and is
 * NEVER implicitly retried with force — this resolves the open concern #740
 * raised about implicit forcing. force:true omits expectedHeadSha so
 * createCommit proceeds against the branch's current remote tip regardless
 * of staleness.
 */
function buildPushTool(ctx: BackgroundAgentGitHubToolContext) {
  return tool({
    description: `Commit the current sandbox changes onto a branch in ${ctx.repoOwner}/${ctx.repoName}. Non-force pushes fail with not_fast_forward if the branch moved since the sandbox last synced; force pushes proceed regardless of remote staleness.`,
    inputSchema: pushInputSchema,
    execute: async ({ branch, force: forceInput }): Promise<PushToolOutput> => {
      // Defensive default: the AI SDK applies inputSchema's zod .default()
      // before calling execute() in production, but execute() may also be
      // invoked directly (as tests do), so default here too.
      const force = forceInput ?? false;
      await stageAll(ctx.sandbox);

      const coAuthor = await buildCoAuthor(ctx.userId);
      const intentResult = await buildCommitIntentFromSandbox({
        sandbox: ctx.sandbox,
        owner: ctx.repoOwner,
        repo: ctx.repoName,
        repositoryId: ctx.repositoryId,
        installationId: ctx.installationId,
        branch,
        baseBranch: ctx.baseBranch,
        message: `chore: push ${ctx.agentName} background changes`.slice(0, 72),
        ...(coAuthor ? { coAuthor } : {}),
      });

      if (!intentResult.ok) {
        const errorKind: GitHubActionErrorKind = intentResult.empty
          ? "no_changes"
          : "access_error";
        await recordActionEvent(ctx, "push", "failed", {
          branch,
          forced: force,
          error: intentResult.error,
        });
        return buildGitHubActionError(errorKind, intentResult.error);
      }

      const { intent } = intentResult;
      const commitResult = await withPerCallInstallationOctokit(
        ctx,
        { contents: "write" },
        (octokit) =>
          createCommit({
            octokit,
            owner: intent.owner,
            repo: intent.repo,
            branch: intent.branch,
            message: intent.message,
            files: intent.files,
            ...(force ? {} : { expectedHeadSha: intent.expectedHeadSha }),
            ...(intent.baseBranch ? { baseBranch: intent.baseBranch } : {}),
            ...(intent.coAuthor ? { coAuthor: intent.coAuthor } : {}),
          }),
      );

      if (!commitResult.ok) {
        const errorKind: GitHubActionErrorKind =
          commitResult.error === REMOTE_BRANCH_CHANGED_ERROR
            ? "not_fast_forward"
            : "access_error";
        await recordActionEvent(ctx, "push", "failed", {
          branch,
          forced: force,
          error: commitResult.error,
        });
        return buildGitHubActionError(errorKind, commitResult.error);
      }

      await recordActionEvent(ctx, "push", "succeeded", {
        branch,
        forced: force,
        sha: commitResult.commitSha,
      });

      return { ok: true, sha: commitResult.commitSha, forced: force };
    },
  });
}

// ── delete_branch action (STEP-8) ───────────────────────────────────────────

const deleteBranchInputSchema = z.object({
  branch: z.string().min(1).describe("The branch to delete."),
});

type DeleteBranchOutput =
  | { ok: true; branch: string }
  | GitHubActionErrorResult;

/**
 * Deletes a branch ref via octokit.rest.git.deleteRef, wrapped in the
 * standard per-call contents:write installation token. Refuses to delete
 * ctx.baseBranch as a minimal safety LABEL on the default branch only — this
 * is not a broader capability wall; every other branch (including ones this
 * run didn't create) can be deleted once delete_branch is enabled, per the
 * agreed scope. Do not extend this into broader gating.
 */
function buildDeleteBranchTool(ctx: BackgroundAgentGitHubToolContext) {
  return tool({
    description: `Delete a branch in ${ctx.repoOwner}/${ctx.repoName}. Refuses to delete the base branch ("${ctx.baseBranch}").`,
    inputSchema: deleteBranchInputSchema,
    execute: async ({ branch }): Promise<DeleteBranchOutput> => {
      if (branch === ctx.baseBranch) {
        await recordActionEvent(ctx, "delete_branch", "failed", {
          branch,
          reason: "protected_branch",
        });
        return buildGitHubActionError(
          "protected_branch",
          `Refusing to delete the base branch "${ctx.baseBranch}".`,
        );
      }

      try {
        await withPerCallInstallationOctokit(
          ctx,
          { contents: "write" },
          (octokit) =>
            octokit.rest.git.deleteRef({
              owner: ctx.repoOwner,
              repo: ctx.repoName,
              ref: `heads/${branch}`,
            }),
        );

        await recordActionEvent(ctx, "delete_branch", "succeeded", {
          branch,
        });
        return { ok: true, branch };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await recordActionEvent(ctx, "delete_branch", "failed", {
          branch,
          error: message,
        });
        return buildGitHubActionError("access_error", message);
      }
    },
  });
}

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
      case "open_pull_request":
        tools.github_open_pull_request = buildOpenPullRequestTool(ctx);
        break;
      case "comment_on_pr_or_issue":
        tools.github_comment_on_pr_or_issue = buildCommentTool(ctx);
        break;
      case "approve_pull_request":
        tools.github_approve_pull_request = buildReviewTool(
          ctx,
          "approve_pull_request",
          "APPROVE",
        );
        break;
      case "request_changes":
        tools.github_request_changes = buildReviewTool(
          ctx,
          "request_changes",
          "REQUEST_CHANGES",
        );
        break;
      case "merge_pull_request":
        tools.github_merge_pull_request = buildMergeTool(ctx);
        break;
      case "push":
        tools.github_push = buildPushTool(ctx);
        break;
      case "delete_branch":
        tools.github_delete_branch = buildDeleteBranchTool(ctx);
        break;
      default:
        break;
    }
  }

  return tools;
}
