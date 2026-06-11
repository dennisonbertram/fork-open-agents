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
        const issues = await withScopedInstallationOctokit({
          installationId: ctx.installationId,
          repositoryId: ctx.repositoryId,
          permissions: { issues: "read" },
          operation: async (octokit) => {
            const response = await octokit.rest.issues.listForRepo({
              owner: ctx.owner,
              repo: ctx.repo,
              state,
              sort: "updated",
              direction: "desc",
              per_page: perPage,
            });
            // GitHub issues API returns PRs too — filter them out
            return response.data.filter((item) => !item.pull_request);
          },
        });

        return {
          ok: true,
          issues: issues.map((issue) => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            labels: issue.labels
              .map((label) =>
                typeof label === "string" ? label : (label.name ?? ""),
              )
              .filter(Boolean),
            updatedAt: issue.updated_at,
            url: issue.html_url,
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
