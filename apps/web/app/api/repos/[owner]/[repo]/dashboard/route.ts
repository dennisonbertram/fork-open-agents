import "server-only";

import { nanoid } from "nanoid";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  listBackgroundAgentRuns,
  listRepoBackgroundAgents,
} from "@/lib/background-agents/store";
import { getBackgroundAgentReadinessWithGitHubAppMetadata } from "@/lib/background-agents/readiness";
import { getBackgroundAgentRepoReadiness } from "@/lib/background-agents/repo-readiness";
import { getRepoDashboardData } from "@/lib/github/repo-dashboard";

type RouteContext = {
  params: Promise<{ owner: string; repo: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { userId } = authResult;
  const { owner, repo } = await context.params;
  const requestId = nanoid();

  // Structured event: fetch started
  console.log(
    JSON.stringify({
      service: "repo-dashboard",
      event: "repo-dashboard.fetch.started",
      level: "info",
      userId,
      repoOwner: owner,
      repoName: repo,
      requestId,
    }),
  );

  const startMs = Date.now();

  try {
    // Fetch all data in parallel — GitHub windows, local agents, readiness
    const [dashboardData, agents, runs, readiness, repoReadiness] =
      await Promise.all([
        getRepoDashboardData({ userId, owner, repo }),
        listRepoBackgroundAgents({ userId, repoOwner: owner, repoName: repo }),
        listBackgroundAgentRuns({
          userId,
          repoOwner: owner,
          repoName: repo,
          limit: 20,
        }),
        getBackgroundAgentReadinessWithGitHubAppMetadata(),
        getBackgroundAgentRepoReadiness({
          userId,
          repoOwner: owner,
          repoName: repo,
          requiredUserPermission: "read",
        }),
      ]);

    const { prSummary, issueSummary, actionsSummary } = dashboardData;

    // Count partial failures for observability
    const partialFailureCount = [
      prSummary,
      issueSummary,
      actionsSummary,
    ].filter((s) => !s.ok).length;

    // Emit partial failure events per window
    if (!prSummary.ok) {
      console.warn(
        JSON.stringify({
          service: "repo-dashboard",
          event: "repo-dashboard.provider.partial_failed",
          level: "warn",
          userId,
          repoOwner: owner,
          repoName: repo,
          requestId,
          window: "pull_requests",
          errorKind: prSummary.errorKind,
        }),
      );
    }

    if (!issueSummary.ok) {
      console.warn(
        JSON.stringify({
          service: "repo-dashboard",
          event: "repo-dashboard.provider.partial_failed",
          level: "warn",
          userId,
          repoOwner: owner,
          repoName: repo,
          requestId,
          window: "issues",
          errorKind: issueSummary.errorKind,
        }),
      );
    }

    if (!actionsSummary.ok) {
      console.warn(
        JSON.stringify({
          service: "repo-dashboard",
          event: "repo-dashboard.provider.partial_failed",
          level: "warn",
          userId,
          repoOwner: owner,
          repoName: repo,
          requestId,
          window: "actions",
          errorKind: actionsSummary.errorKind,
        }),
      );
    }

    const latencyMs = Date.now() - startMs;

    // Structured event: fetch completed
    console.log(
      JSON.stringify({
        service: "repo-dashboard",
        event: "repo-dashboard.fetch.completed",
        level: "info",
        userId,
        repoOwner: owner,
        repoName: repo,
        requestId,
        latencyMs,
        partialFailureCount,
      }),
    );

    return Response.json({
      prSummary,
      issueSummary,
      actionsSummary,
      agents,
      runs,
      readiness,
      repoReadiness,
    });
  } catch (error: unknown) {
    const latencyMs = Date.now() - startMs;
    const errorKind =
      error instanceof Error && error.message === "Not authenticated"
        ? "unknown_dashboard_failure"
        : "unknown_dashboard_failure";

    // Structured event: fetch failed
    console.error(
      JSON.stringify({
        service: "repo-dashboard",
        event: "repo-dashboard.fetch.failed",
        level: "error",
        userId,
        repoOwner: owner,
        repoName: repo,
        requestId,
        latencyMs,
        errorKind,
      }),
    );

    return Response.json(
      { error: "Dashboard data unavailable", errorKind },
      { status: 500 },
    );
  }
}
