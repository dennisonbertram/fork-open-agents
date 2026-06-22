import "server-only";

import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import type { RepoAccessDeniedReason } from "@/lib/github/access";
import { verifyRepoAccess } from "@/lib/github/access";
import { withScopedInstallationOctokit } from "@/lib/github/app";

// ── Error class ────────────────────────────────────────────────────────────────

export class GitHubToolsSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubToolsSetupError";
  }
}

// ── PR pre-flight guard ────────────────────────────────────────────────────────

/**
 * Pre-flight guard: fetches the item by number and throws if the GitHub API
 * indicates it is a pull request (presence of a pull_request field on the
 * issue response). Must be called inside the same withScopedInstallationOctokit
 * operation as the mutation so both share one scoped token. { issues: "write" }
 * already implies read access, so no extra token is needed.
 *
 * NOTE: this adds one extra GET per mutation call. That cost is intentional —
 * it prevents silently mutating pull requests when a PR number is passed, which
 * would violate the tool contract (issue-only) and could cause destructive
 * side effects (e.g. accidentally closing a PR).
 */
async function assertNotPullRequest(
  octokit: {
    rest: {
      issues: {
        get: (params: {
          owner: string;
          repo: string;
          issue_number: number;
        }) => Promise<{ data: { pull_request?: unknown } }>;
      };
    };
  },
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const existing = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });
  if (existing.data.pull_request !== undefined) {
    throw new Error(
      `Issue #${issueNumber} is a pull request; this tool only operates on issues.`,
    );
  }
}

// ── Return type ────────────────────────────────────────────────────────────────

/**
 * Reason values for the "off" variant — lets callers distinguish benign cases
 * (no_repo) from misconfiguration (access_denied) for observability.
 */
export type GitHubToolsOffReason = "no_repo" | "access_denied";

export type ResolvedGitHubTools =
  | {
      status: "off";
      reason?: GitHubToolsOffReason;
      accessDeniedReason?: RepoAccessDeniedReason;
    }
  | {
      status: "ready";
      tools: ToolSet;
      repoOwner: string;
      repoName: string;
    };

// ── github_list_issues tool builder ───────────────────────────────────────────

const listIssuesInputSchema = z.object({
  state: z
    .enum(["open", "closed", "all"])
    .optional()
    .default("open")
    .describe("Filter issues by state. Defaults to open."),
  perPage: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(30)
    .describe("Number of issues to return (1–100). Defaults to 30."),
});

type IssueOutput =
  | {
      ok: true;
      issues: Array<{
        number: number;
        title: string;
        state: string;
        labels: string[];
        updatedAt: string;
        url: string;
      }>;
    }
  | { ok: false; error: string };

function buildListIssuesTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `List issues for the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This tool acts as the GitHub App and returns issues using the app installation token.
Pull requests are automatically excluded — only true issues are returned.
Provide state="open" (default), "closed", or "all".
Prefer this over \`gh issue list\` / \`curl\` for listing issues.`,
    inputSchema: listIssuesInputSchema,
    execute: async ({ state, perPage }): Promise<IssueOutput> => {
      try {
        // Build the search query. The GitHub Search API with `is:issue`
        // excludes pull requests server-side, which avoids the under-delivery
        // bug that occurs when `listForRepo` returns PRs mixed with issues and
        // client-side filtering reduces the result below the requested perPage.
        //
        // State mapping: listForRepo uses state="open"|"closed"|"all", but the
        // search API uses `is:open` / `is:closed` qualifiers. For "all", omit
        // the state qualifier to return both open and closed issues.
        //
        // NOTE: when using GitHub Apps with user access tokens the search API
        // requires the `is:issue` or `is:pull-request` qualifier or it returns
        // a 422 — see GitHub docs. We always include `is:issue`.
        //
        // Rate-limit caveat: the Search API has a lower rate limit (30 req/min
        // authenticated) than the REST API. This is acceptable for agent-driven
        // use: each tool call is one search request.
        const stateQualifier =
          state === "open"
            ? " is:open"
            : state === "closed"
              ? " is:closed"
              : "";
        const q = `repo:${ctx.owner}/${ctx.repo} is:issue${stateQualifier}`;

        const items = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "read" },
          operation: async (octokit) => {
            const response = await octokit.rest.search.issuesAndPullRequests({
              q,
              sort: "updated",
              order: "desc",
              per_page: perPage,
            });
            return response.data.items;
          },
        });

        return {
          ok: true,
          issues: items.map((item) => ({
            number: item.number,
            title: item.title,
            state: item.state,
            labels: item.labels
              .map((label) => label.name ?? "")
              .filter(Boolean),
            updatedAt: item.updated_at,
            url: item.html_url,
          })),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── github_create_issue tool builder ─────────────────────────────────────────

const createIssueInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Title of the new issue. Must not be empty."),
  body: z
    .string()
    .optional()
    .describe("Body / description of the issue in Markdown."),
  labels: z
    .array(z.string())
    .optional()
    .describe("Label names to attach to the new issue."),
  assignees: z
    .array(z.string())
    .optional()
    .describe("GitHub usernames to assign to the new issue."),
});

type CreateIssueOutput =
  | { ok: true; number: number; url: string; state: string; title: string }
  | { ok: false; error: string };

function buildCreateIssueTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `Create a new issue in the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This tool acts as the GitHub App via an installation token scoped to issues:write.
Prefer this over \`gh\`/\`curl\`/the raw API for creating issues — it runs as the GitHub App with the correct scoped permission and an issue-only guard.`,
    inputSchema: createIssueInputSchema,
    execute: async ({
      title,
      body,
      labels,
      assignees,
    }): Promise<CreateIssueOutput> => {
      try {
        const data = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "write" },
          operation: async (octokit) => {
            const response = await octokit.rest.issues.create({
              owner: ctx.owner,
              repo: ctx.repo,
              title,
              body,
              labels,
              assignees,
            });
            return response.data;
          },
        });
        return {
          ok: true,
          number: data.number,
          url: data.html_url,
          state: data.state,
          title: data.title,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── github_update_issue tool builder ─────────────────────────────────────────

const updateIssueInputSchema = z.object({
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe("The issue number to update."),
  title: z.string().optional().describe("New title for the issue."),
  body: z.string().optional().describe("New body / description for the issue."),
  state: z
    .enum(["open", "closed"])
    .optional()
    .describe("Set the issue state to 'open' or 'closed'."),
  stateReason: z
    .enum(["completed", "not_planned", "duplicate", "reopened"])
    .optional()
    .describe(
      "Reason for the state change. Relevant when closing or reopening.",
    ),
});

type UpdateIssueOutput =
  | { ok: true; number: number; url: string; state: string; title: string }
  | { ok: false; error: string };

function buildUpdateIssueTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `Update an existing issue in the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This tool acts as the GitHub App via an installation token scoped to issues:write.
Prefer this over \`gh\`/\`curl\`/the raw API for updating issues — it runs as the GitHub App with the correct scoped permission and an issue-only guard.`,
    inputSchema: updateIssueInputSchema,
    execute: async ({
      issueNumber,
      title,
      body,
      state,
      stateReason,
    }): Promise<UpdateIssueOutput> => {
      try {
        const data = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "write" },
          operation: async (octokit) => {
            await assertNotPullRequest(
              octokit,
              ctx.owner,
              ctx.repo,
              issueNumber,
            );
            const response = await octokit.rest.issues.update({
              owner: ctx.owner,
              repo: ctx.repo,
              issue_number: issueNumber,
              title,
              body,
              state,
              state_reason: stateReason,
            });
            return response.data;
          },
        });
        return {
          ok: true,
          number: data.number,
          url: data.html_url,
          state: data.state,
          title: data.title,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── github_comment_on_issue tool builder ─────────────────────────────────────

const commentOnIssueInputSchema = z.object({
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe("The issue number to comment on."),
  body: z.string().min(1).describe("The comment text in Markdown."),
});

type CommentOnIssueOutput =
  | { ok: true; commentId: number; url: string }
  | { ok: false; error: string };

function buildCommentOnIssueTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `Post a comment on an issue in the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This tool acts as the GitHub App via an installation token scoped to issues:write.
Prefer this over \`gh\`/\`curl\`/the raw API for commenting on issues — it runs as the GitHub App with the correct scoped permission and an issue-only guard.`,
    inputSchema: commentOnIssueInputSchema,
    execute: async ({ issueNumber, body }): Promise<CommentOnIssueOutput> => {
      try {
        const data = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "write" },
          operation: async (octokit) => {
            await assertNotPullRequest(
              octokit,
              ctx.owner,
              ctx.repo,
              issueNumber,
            );
            const response = await octokit.rest.issues.createComment({
              owner: ctx.owner,
              repo: ctx.repo,
              issue_number: issueNumber,
              body,
            });
            return response.data;
          },
        });
        return {
          ok: true,
          commentId: data.id,
          url: data.html_url,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── github_set_issue_labels tool builder ──────────────────────────────────────

const setIssueLabelsInputSchema = z.object({
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe("The issue number whose labels to replace."),
  labels: z
    .array(z.string())
    .describe(
      "Replaces all existing labels; empty array clears all labels on the issue.",
    ),
});

type SetIssueLabelsOutput =
  | { ok: true; labels: string[] }
  | { ok: false; error: string };

function buildSetIssueLabelsTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `Replace all labels on an issue in the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This is a PUT operation — it replaces all existing labels. Pass an empty array to clear all labels.
This tool acts as the GitHub App via an installation token scoped to issues:write.
Prefer this over \`gh\`/\`curl\`/the raw API for setting issue labels — it runs as the GitHub App with the correct scoped permission and an issue-only guard.`,
    inputSchema: setIssueLabelsInputSchema,
    execute: async ({ issueNumber, labels }): Promise<SetIssueLabelsOutput> => {
      try {
        const data = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "write" },
          operation: async (octokit) => {
            await assertNotPullRequest(
              octokit,
              ctx.owner,
              ctx.repo,
              issueNumber,
            );
            const response = await octokit.rest.issues.setLabels({
              owner: ctx.owner,
              repo: ctx.repo,
              issue_number: issueNumber,
              labels,
            });
            return response.data;
          },
        });
        return {
          ok: true,
          labels: data.map((l) => l.name),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── github_close_issue tool builder ──────────────────────────────────────────

const closeIssueInputSchema = z.object({
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe("The issue number to close."),
  stateReason: z
    .enum(["completed", "not_planned"])
    .optional()
    .default("completed")
    .describe(
      "Reason for closing the issue. Defaults to 'completed'. Use 'not_planned' for won't-fix closures.",
    ),
});

type CloseIssueOutput =
  | { ok: true; number: number; url: string; state: string }
  | { ok: false; error: string };

function buildCloseIssueTool(ctx: {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
}) {
  return tool({
    description: `Close an issue in the bound GitHub repository (${ctx.owner}/${ctx.repo}).
This tool acts as the GitHub App via an installation token scoped to issues:write.
Prefer this over \`gh\`/\`curl\`/the raw API for closing issues — it runs as the GitHub App with the correct scoped permission and an issue-only guard.`,
    inputSchema: closeIssueInputSchema,
    execute: async ({
      issueNumber,
      stateReason,
    }): Promise<CloseIssueOutput> => {
      // Zod .default("completed") serves schema/LLM-facing callers that go
      // through the AI SDK's input coercion layer.  The ?? "completed" guard
      // covers direct execute() invocations (e.g. in tests) where Zod's
      // .default() transformation has not run.  Both are intentional; do not
      // remove either.
      const resolvedStateReason = stateReason ?? "completed";
      try {
        const data = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "write" },
          operation: async (octokit) => {
            await assertNotPullRequest(
              octokit,
              ctx.owner,
              ctx.repo,
              issueNumber,
            );
            const response = await octokit.rest.issues.update({
              owner: ctx.owner,
              repo: ctx.repo,
              issue_number: issueNumber,
              state: "closed",
              state_reason: resolvedStateReason,
            });
            return response.data;
          },
        });
        return {
          ok: true,
          number: data.number,
          url: data.html_url,
          state: data.state,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return { ok: false, error: message };
      }
    },
  });
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Resolves GitHub tools for a chat step. Mirrors resolveComposioToolsForChat.
 *
 * Returns { status: "off", reason } when:
 *  - No repo is bound to the session
 *  - Repo access is denied (user or app permission issue)
 *
 * The reason field distinguishes benign no-repo cases from access
 * misconfiguration for observability.
 *
 * Throws GitHubToolsSetupError on unexpected failures.
 */
export async function resolveGitHubToolsForChat(params: {
  userId: string;
  chatId: string;
}): Promise<ResolvedGitHubTools> {
  const chat = await getChatById(params.chatId);
  if (!chat) {
    throw new GitHubToolsSetupError("Chat not found for GitHub tool setup.");
  }

  const sessionRecord = await getSessionById(chat.sessionId);
  const repoOwner = sessionRecord?.repoOwner ?? null;
  const repoName = sessionRecord?.repoName ?? null;

  // No repo bound → benign off, not an error
  if (!repoOwner || !repoName) {
    return { status: "off", reason: "no_repo" };
  }

  // Repo access check: intersects user permissions with app installation scope
  const access = await verifyRepoAccess({
    userId: params.userId,
    owner: repoOwner,
    repo: repoName,
    requiredUserPermission: "read",
  });

  if (!access.ok) {
    // Permission/installation denial is a gating outcome, not a crash.
    // Callers can detect this distinct case (vs no_repo) for observability.
    return {
      status: "off",
      reason: "access_denied",
      accessDeniedReason: access.reason,
    };
  }

  // Shared context passed to every tool builder — avoids repetition
  const ctx = {
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    owner: repoOwner,
    repo: repoName,
  };

  const tools: ToolSet = {
    github_list_issues: buildListIssuesTool(ctx),
  };

  // Write tools are only included for users with push/maintain/admin access.
  // Read-only users who opted in still get github_list_issues.
  if (access.userPermission === "write") {
    tools.github_create_issue = buildCreateIssueTool(ctx);
    tools.github_update_issue = buildUpdateIssueTool(ctx);
    tools.github_comment_on_issue = buildCommentOnIssueTool(ctx);
    tools.github_set_issue_labels = buildSetIssueLabelsTool(ctx);
    tools.github_close_issue = buildCloseIssueTool(ctx);
  }

  return {
    status: "ready",
    tools,
    repoOwner,
    repoName,
  };
}
