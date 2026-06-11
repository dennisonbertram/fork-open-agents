import "server-only";

import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import { resolveAgentForRole } from "@/lib/agents/resolve-agent";
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

// ── Return type ────────────────────────────────────────────────────────────────

/**
 * Reason values for the "off" variant — lets callers distinguish benign cases
 * (not_enabled, no_repo) from misconfiguration (access_denied) for observability.
 */
export type GitHubToolsOffReason =
  | "not_enabled"
  | "no_repo"
  | "access_denied"
  | "non_classic_runtime";

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
Provide state="open" (default), "closed", or "all".`,
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

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Resolves GitHub tools for a chat step. Mirrors resolveComposioToolsForChat.
 *
 * Returns { status: "off", reason } when:
 *  - runtimeMode is non-classic (managed_runtime — tools are dropped by agent allowlist)
 *  - No repo is bound to the session
 *  - The githubToolsEnabled gate is off on the agent row
 *  - Repo access is denied (user or app permission issue)
 *
 * The reason field distinguishes benign cases (not_enabled, no_repo,
 * non_classic_runtime) from misconfiguration (access_denied) for observability.
 *
 * Throws GitHubToolsSetupError on unexpected failures.
 *
 * NOTE: classic runtime mode only. In managed_runtime mode, the agent-package
 * tool allowlist (packages/agent/open-agent.ts) drops injected tools anyway.
 * PR1 scope: githubToolsEnabled can only be set true via direct DB write; the
 * settings UI writer that lets users enable this gate lands in PR2.
 */
export async function resolveGitHubToolsForChat(params: {
  userId: string;
  chatId: string;
  runtimeMode?: "classic" | "managed_runtime";
}): Promise<ResolvedGitHubTools> {
  // GitHub tools are classic-mode only — managed_runtime drops injected tools
  // at the agent-package layer, so skip the session/access/mint round-trip.
  if (params.runtimeMode && params.runtimeMode !== "classic") {
    return { status: "off", reason: "non_classic_runtime" };
  }

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

  // Gate check: only enable when the agent row opts in
  // PR1 scope: the UI writer that lets users flip githubToolsEnabled lands in PR2.
  const agentRow = await resolveAgentForRole({
    userId: params.userId,
    role: "main",
    sessionId: chat.sessionId,
  });

  if (!agentRow.githubToolsEnabled) {
    return { status: "off", reason: "not_enabled" };
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
    // Callers can detect this distinct case (vs not_enabled/no_repo) for
    // observability — an opted-in user's misconfiguration should be surfaced.
    return {
      status: "off",
      reason: "access_denied",
      accessDeniedReason: access.reason,
    };
  }

  const tools: ToolSet = {
    github_list_issues: buildListIssuesTool({
      installationId: access.installationId,
      repositoryId: access.repositoryId,
      owner: repoOwner,
      repo: repoName,
    }),
  };

  return {
    status: "ready",
    tools,
    repoOwner,
    repoName,
  };
}
