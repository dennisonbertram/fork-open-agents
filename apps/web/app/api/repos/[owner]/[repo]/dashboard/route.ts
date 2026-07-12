import "server-only";

import { nanoid } from "nanoid";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  listBackgroundAgentRuns,
  listRepoBackgroundAgents,
} from "@/lib/background-agents/store";
import { toPublicBackgroundAgentRun } from "@/lib/background-agents/public-run";
import { getBackgroundAgentReadinessWithGitHubAppMetadata } from "@/lib/background-agents/readiness";
import { getBackgroundAgentRepoReadiness } from "@/lib/background-agents/repo-readiness";
import { getRepoDashboardData } from "@/lib/github/repo-dashboard";
import type {
  DashboardErrorKind,
  PrSummary,
  IssueSummary,
  ActionsSummary,
} from "@/lib/github/repo-dashboard";

type RouteContext = {
  params: Promise<{ owner: string; repo: string }>;
};

/**
 * Map a BackgroundAgentRepoReadiness denial reason to a DashboardErrorKind
 * so GitHub windows can show the correct setup state.
 */
function repoReadinessToDashboardErrorKind(
  reason: string | null,
): DashboardErrorKind | null {
  if (reason === "no_installation") return "installation_missing";
  if (reason === "app_no_access") return "app_no_access";
  return null;
}

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
    // Fetch all data sources in parallel with independent failure isolation.
    // GitHub dashboard data, local agents, runs, and readiness checks must
    // never cascade — a failure in one must not block the others.
    const [
      dashboardDataResult,
      agentsResult,
      runsResult,
      readinessResult,
      repoReadinessResult,
    ] = await Promise.allSettled([
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

    // Extract dashboard data (GitHub windows) with safe fallbacks
    const dashboardData =
      dashboardDataResult.status === "fulfilled"
        ? dashboardDataResult.value
        : {
            prSummary: {
              ok: false,
              errorKind: "provider_unavailable",
            } as const,
            issueSummary: {
              ok: false,
              errorKind: "provider_unavailable",
            } as const,
            actionsSummary: {
              ok: false,
              errorKind: "provider_unavailable",
            } as const,
          };

    let { prSummary, issueSummary, actionsSummary } = dashboardData;

    // BLOCKER 2: If repo readiness reveals App coverage is missing, override
    // the GitHub window error kinds so we show the correct setup state
    // instead of presenting OAuth-token data as if it were App-verified.
    if (repoReadinessResult.status === "fulfilled") {
      const repoReadiness = repoReadinessResult.value;
      const appErrorKind = repoReadinessToDashboardErrorKind(
        repoReadiness.reason,
      );
      if (appErrorKind !== null) {
        const override = { ok: false as const, errorKind: appErrorKind };
        prSummary = override as PrSummary;
        issueSummary = override as IssueSummary;
        actionsSummary = override as ActionsSummary;
      }
    }

    // Safe fallbacks for local data sources
    const agents =
      agentsResult.status === "fulfilled" ? agentsResult.value : [];
    const runs =
      runsResult.status === "fulfilled"
        ? runsResult.value.map((run) =>
            "executionSnapshot" in run
              ? toPublicBackgroundAgentRun(
                  run as Parameters<typeof toPublicBackgroundAgentRun>[0],
                )
              : run,
          )
        : [];
    const readiness =
      readinessResult.status === "fulfilled"
        ? readinessResult.value
        : { ready: false, checks: [], missing: [] };
    const repoReadiness =
      repoReadinessResult.status === "fulfilled"
        ? repoReadinessResult.value
        : null;

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
  } catch {
    const latencyMs = Date.now() - startMs;
    const errorKind: DashboardErrorKind = "unknown_dashboard_failure";

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
