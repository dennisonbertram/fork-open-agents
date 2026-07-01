import "server-only";

import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { Sandbox } from "@open-agents/sandbox";
import type { NewBackgroundAgentOutput } from "@/lib/db/schema";
import { verifyRepoAccess } from "@/lib/github/access";
import { withScopedInstallationOctokit } from "@/lib/github/app";
import { createCommit } from "@/lib/github/commit";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import {
  deleteBranchRef,
  getMergeReadinessViaInstallation,
  mergePullRequest,
  openPullRequest,
  submitPullRequestReview,
} from "@/lib/github/pulls";
import {
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
} from "./store";

// ── Public types (reused by later tickets — keep in this module) ──────────────

/**
 * Per-action enable/disable toggles for the seven native GitHub action tools.
 * The factory only includes a tool in the returned ToolSet when its toggle
 * is true.
 */
export type GitHubActionToggles = {
  openPullRequest: boolean;
  commentOnPrOrIssue: boolean;
  approvePullRequest: boolean;
  requestChanges: boolean;
  mergePullRequest: boolean;
  push: boolean;
  deleteBranch: boolean;
};

/**
 * A single repo reference used by the "specific_repos" write scope mode.
 */
export type BackgroundAgentWriteScopeRepo = {
  owner: string;
  name: string;
};

/**
 * Governs which repos a background agent run is allowed to write to.
 *  - "this_repo": only the run's bound repo (ctx.repoOwner/ctx.repoName).
 *  - "all_repos": any repo the installation + user can access.
 *  - "specific_repos": only repos explicitly listed in `repos`.
 */
export type BackgroundAgentWriteScope =
  | { mode: "this_repo" }
  | { mode: "all_repos" }
  | { mode: "specific_repos"; repos: BackgroundAgentWriteScopeRepo[] };

/**
 * Typed error kinds surfaced on `background-agent.github.<action>.failed`
 * events and returned to the model as part of the `{ ok: false, error }`
 * result shape.
 */
export type GitHubActionErrorKind =
  | "write_scope_denied"
  | "ci_not_green"
  | "github_api_error"
  | "token_mint_failed";

/**
 * Context shared by every GitHub action tool builder. One instance is
 * created per background-agent run and passed to `resolveGitHubActionTools`.
 */
export type GitHubActionToolsContext = {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId?: string | null;
  installationId: number;
  repositoryId: number;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  sandbox?: Sandbox;
  toggles: GitHubActionToggles;
  writeScope: BackgroundAgentWriteScope;
  requireCiGreen: boolean;
  userPermission: "read" | "write";
  /**
   * Maps each action name to the `backgroundAgentOutputs.kind` value to
   * record for a successful call. Defaults to "none" when an action is
   * absent from the map.
   *
   * TODO(#745): once the outputs.kind enum is extended with action-specific
   * values (e.g. "pr_opened", "pr_merged", "branch_deleted"), background
   * agent run setup should populate this map with those values instead of
   * relying on the "none" default.
   */
  outputKindByAction?: Partial<
    Record<GitHubActionName, NewBackgroundAgentOutput["kind"]>
  >;
};

type GitHubActionName =
  | "open_pull_request"
  | "comment_on_pr_or_issue"
  | "approve_pull_request"
  | "request_changes"
  | "merge_pull_request"
  | "push"
  | "delete_branch";

// ── Result shape ────────────────────────────────────────────────────────────

type ActionOk = Record<string, unknown> & { ok: true };
/** `errorKind` is optional: `perform` implementations set it to override the
 * default "github_api_error" classification (e.g. merge's "ci_not_green"). */
type ActionErr = {
  ok: false;
  error: string;
  errorKind?: GitHubActionErrorKind;
};
type ActionResult = ActionOk | ActionErr;

// ── Shared execute() scaffolding ────────────────────────────────────────────

type RepoTarget = { owner: string; repo: string };

function targetsRepo(
  scope: BackgroundAgentWriteScope,
  target: RepoTarget,
): boolean {
  const ownerLower = target.owner.toLowerCase();
  const repoLower = target.repo.toLowerCase();

  switch (scope.mode) {
    case "all_repos":
      return true;
    case "this_repo":
      return false; // caller compares against ctx.repoOwner/repoName directly
    case "specific_repos":
      return scope.repos.some(
        (repo) =>
          repo.owner.toLowerCase() === ownerLower &&
          repo.name.toLowerCase() === repoLower,
      );
    default:
      return false;
  }
}

type WriteScopeCheck = { ok: true } | { ok: false; reason: string };

/**
 * Enforces the write-scope check for a target repo: the target must satisfy
 * ctx.writeScope's mode (this_repo/all_repos/specific_repos) AND pass
 * verifyRepoAccess. Both checks run unconditionally for every call — mode
 * first (cheap, no network), then verifyRepoAccess (confirms the acting
 * user + installation actually have write access to the target repo).
 */
async function checkWriteScope(
  ctx: GitHubActionToolsContext,
  target: RepoTarget,
): Promise<WriteScopeCheck> {
  const isBoundRepo =
    target.owner.toLowerCase() === ctx.repoOwner.toLowerCase() &&
    target.repo.toLowerCase() === ctx.repoName.toLowerCase();

  const modeAllows =
    ctx.writeScope.mode === "this_repo"
      ? isBoundRepo
      : targetsRepo(ctx.writeScope, target);

  if (!modeAllows) {
    return {
      ok: false,
      reason: "Target repo is outside the configured write scope",
    };
  }

  const access = await verifyRepoAccess({
    userId: ctx.userId,
    owner: target.owner,
    repo: target.repo,
    requiredUserPermission: "write",
  });

  return access.ok
    ? { ok: true }
    : { ok: false, reason: `Repo access denied: ${access.reason}` };
}

function repoUrlFor(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

function targetRepoLabel(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

type RunActionParams = {
  ctx: GitHubActionToolsContext;
  action: GitHubActionName;
  target: RepoTarget;
  extraStartPayload?: Record<string, unknown>;
  /** Executes the actual GitHub write. Receives the resolved permissions. */
  perform: (helpers: {
    withOctokit: <T>(
      permissions: Record<string, "read" | "write">,
      operation: (octokit: unknown) => Promise<T>,
    ) => Promise<T>;
  }) => Promise<ActionResult>;
};

/**
 * Shared wrapper for every action's execute(): enforces write-scope first,
 * then runs `perform`, recording unconditional started/completed/failed
 * audit events and an outputs row on success or failure. `perform` is
 * responsible for minting its own fresh per-call token(s) via `withOctokit`.
 */
async function runGitHubAction(params: RunActionParams): Promise<ActionResult> {
  const { ctx, action, target, extraStartPayload, perform } = params;
  const eventPrefix = `background-agent.github.${action}`;
  const targetRepo = targetRepoLabel(target.owner, target.repo);

  await recordBackgroundAgentEvent({
    runId: ctx.runId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    eventName: `${eventPrefix}.started`,
    status: "started",
    workflowRunId: ctx.workflowRunId ?? null,
    payload: {
      runId: ctx.runId,
      agentId: ctx.agentId,
      targetRepo,
      ...extraStartPayload,
    },
  });

  const scopeCheck = await checkWriteScope(ctx, target);
  if (!scopeCheck.ok) {
    return failAction({
      ctx,
      action,
      eventPrefix,
      targetRepo,
      errorKind: "write_scope_denied",
      error: scopeCheck.reason,
    });
  }

  const withOctokit = async <T>(
    permissions: Record<string, "read" | "write">,
    operation: (octokit: unknown) => Promise<T>,
  ): Promise<T> => {
    try {
      return await withScopedInstallationOctokit({
        installationId: ctx.installationId,
        repositoryId: ctx.repositoryId,
        permissions,
        operation,
      });
    } catch (error) {
      throw new TokenMintError(
        error instanceof Error ? error.message : "Failed to mint token",
      );
    }
  };

  let result: ActionResult;
  try {
    result = await perform({ withOctokit });
  } catch (error) {
    if (error instanceof TokenMintError) {
      return failAction({
        ctx,
        action,
        eventPrefix,
        targetRepo,
        errorKind: "token_mint_failed",
        error: error.message,
      });
    }

    return failAction({
      ctx,
      action,
      eventPrefix,
      targetRepo,
      errorKind: "github_api_error",
      error: error instanceof Error ? error.message : "GitHub API error",
    });
  }

  if (!result.ok) {
    return failAction({
      ctx,
      action,
      eventPrefix,
      targetRepo,
      errorKind: result.errorKind ?? "github_api_error",
      error: result.error,
    });
  }

  await recordBackgroundAgentEvent({
    runId: ctx.runId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    eventName: `${eventPrefix}.completed`,
    status: "succeeded",
    workflowRunId: ctx.workflowRunId ?? null,
    payload: {
      runId: ctx.runId,
      agentId: ctx.agentId,
      targetRepo,
      ...result,
    },
  });

  await recordBackgroundAgentOutput({
    runId: ctx.runId,
    userId: ctx.userId,
    kind: ctx.outputKindByAction?.[action] ?? "none",
    status: "created",
    url: typeof result.url === "string" ? result.url : null,
    prNumber: typeof result.prNumber === "number" ? result.prNumber : null,
    payload: { action, ...result },
  });

  return result;
}

class TokenMintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenMintError";
  }
}

async function failAction(params: {
  ctx: GitHubActionToolsContext;
  action: GitHubActionName;
  eventPrefix: string;
  targetRepo: string;
  errorKind: GitHubActionErrorKind;
  error: string;
}): Promise<ActionErr> {
  const { ctx, action, eventPrefix, targetRepo, errorKind, error } = params;

  await recordBackgroundAgentEvent({
    runId: ctx.runId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    eventName: `${eventPrefix}.failed`,
    status: "failed",
    level: "warn",
    workflowRunId: ctx.workflowRunId ?? null,
    errorKind,
    payload: { runId: ctx.runId, agentId: ctx.agentId, targetRepo, error },
  });

  await recordBackgroundAgentOutput({
    runId: ctx.runId,
    userId: ctx.userId,
    kind: ctx.outputKindByAction?.[action] ?? "none",
    status: "failed",
    payload: { action, errorKind, error },
  });

  return { ok: false, error };
}

// ── github_open_pull_request ───────────────────────────────────────────────

const openPullRequestInputSchema = z.object({
  branchName: z.string().min(1).describe("Head branch name for the PR."),
  headRef: z
    .string()
    .optional()
    .describe("Explicit head ref (owner:branch) for cross-fork PRs."),
  title: z.string().min(1).describe("Pull request title."),
  body: z.string().optional().describe("Pull request body in Markdown."),
  baseBranch: z
    .string()
    .optional()
    .default("main")
    .describe("Base branch to merge into. Defaults to 'main'."),
  isDraft: z.boolean().optional().describe("Open as a draft PR."),
});

function buildOpenPullRequestTool(ctx: GitHubActionToolsContext) {
  return tool({
    description: `Open a pull request in ${ctx.repoOwner}/${ctx.repoName} using the GitHub App installation identity.`,
    inputSchema: openPullRequestInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action: "open_pull_request",
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { branchName: input.branchName },
        perform: async ({ withOctokit }) =>
          withOctokit({ pull_requests: "write" }, async (octokit) => {
            const result = await openPullRequest({
              repoUrl: repoUrlFor(ctx.repoOwner, ctx.repoName),
              branchName: input.branchName,
              headRef: input.headRef,
              title: input.title,
              body: input.body,
              baseBranch: input.baseBranch ?? "main",
              isDraft: input.isDraft,
              // biome-ignore lint: octokit is typed as unknown at this boundary
              octokit: octokit as never,
            });

            return result.success
              ? ({
                  ok: true,
                  prUrl: result.prUrl,
                  url: result.prUrl,
                  prNumber: result.prNumber,
                } as const)
              : ({
                  ok: false,
                  error: result.error ?? "Failed to open pull request",
                } as const);
          }),
      }),
  });
}

// ── github_comment_on_pr_or_issue ──────────────────────────────────────────

const commentInputSchema = z.object({
  issueOrPrNumber: z
    .number()
    .int()
    .positive()
    .describe("Issue or pull request number to comment on."),
  body: z.string().min(1).describe("Comment text in Markdown."),
});

function buildCommentTool(ctx: GitHubActionToolsContext) {
  return tool({
    description: `Comment on an issue or pull request in ${ctx.repoOwner}/${ctx.repoName}. Accepts either an issue or a PR number — no issue-only guard.`,
    inputSchema: commentInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action: "comment_on_pr_or_issue",
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { issueOrPrNumber: input.issueOrPrNumber },
        perform: async ({ withOctokit }) =>
          withOctokit({ issues: "write" }, async (octokit) => {
            const client = octokit as {
              rest: {
                issues: {
                  createComment: (params: {
                    owner: string;
                    repo: string;
                    issue_number: number;
                    body: string;
                  }) => Promise<{ data: { id: number; html_url: string } }>;
                };
              };
            };

            const response = await client.rest.issues.createComment({
              owner: ctx.repoOwner,
              repo: ctx.repoName,
              issue_number: input.issueOrPrNumber,
              body: input.body,
            });

            return {
              ok: true,
              commentId: response.data.id,
              url: response.data.html_url,
            } as const;
          }),
      }),
  });
}

// ── github_approve_pull_request / github_request_changes ──────────────────

const reviewInputSchema = z.object({
  prNumber: z.number().int().positive().describe("Pull request number."),
  body: z.string().optional().describe("Review comment body."),
});

function buildReviewTool(
  ctx: GitHubActionToolsContext,
  event: "APPROVE" | "REQUEST_CHANGES",
) {
  const action: GitHubActionName =
    event === "APPROVE" ? "approve_pull_request" : "request_changes";
  const description =
    event === "APPROVE"
      ? `Approve a pull request in ${ctx.repoOwner}/${ctx.repoName}. Submitted as the GitHub App installation identity — GitHub rejects self-approval when the PR author matches this identity.`
      : `Request changes on a pull request in ${ctx.repoOwner}/${ctx.repoName}.`;

  return tool({
    description,
    inputSchema: reviewInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action,
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { prNumber: input.prNumber },
        perform: async ({ withOctokit }) =>
          withOctokit({ pull_requests: "write" }, async (octokit) => {
            const result = await submitPullRequestReview({
              repoUrl: repoUrlFor(ctx.repoOwner, ctx.repoName),
              prNumber: input.prNumber,
              event,
              body: input.body,
              // biome-ignore lint: octokit is typed as unknown at this boundary
              octokit: octokit as never,
            });

            return result.success
              ? ({ ok: true, reviewId: result.reviewId } as const)
              : ({
                  ok: false,
                  error: result.error ?? "Failed to submit review",
                } as const);
          }),
      }),
  });
}

// ── github_merge_pull_request ──────────────────────────────────────────────

const mergeInputSchema = z.object({
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("Pull request number to merge."),
  mergeMethod: z
    .enum(["merge", "squash", "rebase"])
    .optional()
    .describe("Merge method. Defaults to the repo's preferred method."),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
});

function buildMergeTool(ctx: GitHubActionToolsContext) {
  return tool({
    description: `Merge a pull request in ${ctx.repoOwner}/${ctx.repoName}.${
      ctx.requireCiGreen
        ? " Refuses when required checks are not all green."
        : ""
    }`,
    inputSchema: mergeInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action: "merge_pull_request",
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { prNumber: input.prNumber },
        perform: async ({ withOctokit }) =>
          withOctokit({ pull_requests: "write" }, async (octokit) => {
            if (ctx.requireCiGreen) {
              const readiness = await getMergeReadinessViaInstallation({
                repoUrl: repoUrlFor(ctx.repoOwner, ctx.repoName),
                prNumber: input.prNumber,
                // biome-ignore lint: octokit is typed as unknown at this boundary
                octokit: octokit as never,
              });

              const hasBlockingChecks =
                readiness.checks.failed > 0 || readiness.checks.pending > 0;

              if (!readiness.canMerge || hasBlockingChecks) {
                return {
                  ok: false,
                  error:
                    readiness.reasons.join("; ") ||
                    "Required checks are not green",
                  errorKind: "ci_not_green",
                } satisfies ActionErr;
              }
            }

            const result = await mergePullRequest({
              repoUrl: repoUrlFor(ctx.repoOwner, ctx.repoName),
              prNumber: input.prNumber,
              mergeMethod: input.mergeMethod,
              commitTitle: input.commitTitle,
              commitMessage: input.commitMessage,
              // biome-ignore lint: octokit is typed as unknown at this boundary
              octokit: octokit as never,
            });

            return result.success
              ? ({ ok: true, sha: result.sha } as const)
              : ({
                  ok: false,
                  error: result.error ?? "Failed to merge pull request",
                } as const);
          }),
      }),
  });
}

// ── github_push ────────────────────────────────────────────────────────────

const pushInputSchema = z.object({
  branch: z.string().min(1).describe("Branch to commit and push to."),
  message: z.string().min(1).describe("Commit message."),
  baseBranch: z
    .string()
    .optional()
    .describe(
      "Base branch to create the target branch from if it does not exist.",
    ),
});

function buildPushTool(ctx: GitHubActionToolsContext) {
  return tool({
    description: `Commit sandbox working-tree changes and push them to a branch in ${ctx.repoOwner}/${ctx.repoName}.`,
    inputSchema: pushInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action: "push",
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { branch: input.branch },
        perform: async ({ withOctokit }) => {
          if (!ctx.sandbox) {
            return {
              ok: false,
              error: "No sandbox available for this run",
            } as const;
          }

          const intentResult = await buildCommitIntentFromSandbox({
            sandbox: ctx.sandbox,
            owner: ctx.repoOwner,
            repo: ctx.repoName,
            repositoryId: ctx.repositoryId,
            installationId: ctx.installationId,
            branch: input.branch,
            baseBranch: input.baseBranch,
            message: input.message,
          });

          if (!intentResult.ok) {
            return { ok: false, error: intentResult.error } as const;
          }

          return withOctokit({ contents: "write" }, async (octokit) => {
            const result = await createCommit({
              // biome-ignore lint: octokit is typed as unknown at this boundary
              octokit: octokit as never,
              owner: intentResult.intent.owner,
              repo: intentResult.intent.repo,
              branch: intentResult.intent.branch,
              baseBranch: intentResult.intent.baseBranch,
              expectedHeadSha: intentResult.intent.expectedHeadSha,
              message: intentResult.intent.message,
              files: intentResult.intent.files,
              coAuthor: intentResult.intent.coAuthor,
            });

            return result.ok
              ? ({ ok: true, sha: result.commitSha } as const)
              : ({ ok: false, error: result.error } as const);
          });
        },
      }),
  });
}

// ── github_delete_branch ────────────────────────────────────────────────────

const deleteBranchInputSchema = z.object({
  branch: z.string().min(1).describe("Branch name to delete."),
});

function buildDeleteBranchTool(ctx: GitHubActionToolsContext) {
  return tool({
    description: `Delete a branch in ${ctx.repoOwner}/${ctx.repoName}. Refuses to delete the repo's default branch (${ctx.defaultBranch}).`,
    inputSchema: deleteBranchInputSchema,
    execute: async (input): Promise<ActionResult> =>
      runGitHubAction({
        ctx,
        action: "delete_branch",
        target: { owner: ctx.repoOwner, repo: ctx.repoName },
        extraStartPayload: { branch: input.branch },
        perform: async ({ withOctokit }) => {
          if (input.branch === ctx.defaultBranch) {
            return {
              ok: false,
              error: `Refusing to delete the default branch '${ctx.defaultBranch}'`,
            } as const;
          }

          return withOctokit({ contents: "write" }, async (octokit) => {
            const result = await deleteBranchRef({
              repoUrl: repoUrlFor(ctx.repoOwner, ctx.repoName),
              branchName: input.branch,
              // biome-ignore lint: octokit is typed as unknown at this boundary
              octokit: octokit as never,
            });

            return result.success
              ? ({ ok: true } as const)
              : ({
                  ok: false,
                  error: result.error ?? "Failed to delete branch",
                } as const);
          });
        },
      }),
  });
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Builds the model-callable GitHub action ToolSet for a background-agent
 * run. Only actions whose `ctx.toggles` flag is true are included. Every
 * tool enforces write-scope, mints a fresh minimum-permission token per
 * call, and records an unconditional audit trail (see runGitHubAction).
 */
export function resolveGitHubActionTools(
  ctx: GitHubActionToolsContext,
): ToolSet {
  const tools: ToolSet = {};

  if (ctx.toggles.openPullRequest) {
    tools.github_open_pull_request = buildOpenPullRequestTool(ctx);
  }
  if (ctx.toggles.commentOnPrOrIssue) {
    tools.github_comment_on_pr_or_issue = buildCommentTool(ctx);
  }
  if (ctx.toggles.approvePullRequest) {
    tools.github_approve_pull_request = buildReviewTool(ctx, "APPROVE");
  }
  if (ctx.toggles.requestChanges) {
    tools.github_request_changes = buildReviewTool(ctx, "REQUEST_CHANGES");
  }
  if (ctx.toggles.mergePullRequest) {
    tools.github_merge_pull_request = buildMergeTool(ctx);
  }
  if (ctx.toggles.push) {
    tools.github_push = buildPushTool(ctx);
  }
  if (ctx.toggles.deleteBranch) {
    tools.github_delete_branch = buildDeleteBranchTool(ctx);
  }

  return tools;
}
