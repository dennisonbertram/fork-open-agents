import "server-only";

import { listAutomations } from "@/lib/automations/store";
import { listDbBackedAutomationRuns } from "@/lib/runs/store";

export type RepositorySummaryValue =
  | { status: "ready" | "partial"; count: number; hasMore?: true }
  | { status: "error" };

export type RepositoryDashboardSummary = {
  automations: RepositorySummaryValue;
  runs: RepositorySummaryValue;
};

export type RepositoryDashboardSummaryDependencies = {
  listAutomations: typeof listAutomations;
  listRuns: typeof listDbBackedAutomationRuns;
};

const defaultDependencies: RepositoryDashboardSummaryDependencies = {
  listAutomations,
  listRuns: listDbBackedAutomationRuns,
};

export async function loadRepositoryDashboardSummary(
  params: { userId: string; owner: string; repo: string },
  dependencies: RepositoryDashboardSummaryDependencies = defaultDependencies,
): Promise<RepositoryDashboardSummary> {
  const [automationsResult, runsResult] = await Promise.allSettled([
    dependencies.listAutomations({
      userId: params.userId,
      filters: {
        repository: { owner: params.owner, name: params.repo },
      },
    }),
    dependencies.listRuns({
      userId: params.userId,
      requestId: crypto.randomUUID(),
      filters: {
        view: "all",
        repoOwner: params.owner,
        repoName: params.repo,
      },
      limit: 5,
    }),
  ]);

  const automations: RepositorySummaryValue =
    automationsResult.status === "rejected"
      ? { status: "error" }
      : {
          status: automationsResult.value.sourceStatus.some(
            (source) =>
              source.status === "failed" || source.status === "partial",
          )
            ? "partial"
            : "ready",
          count: automationsResult.value.total,
        };

  let runs: RepositorySummaryValue;
  if (runsResult.status === "rejected" || runsResult.value.allSourcesFailed) {
    runs = { status: "error" };
  } else {
    runs = {
      status: runsResult.value.sourceStatus.some(
        (source) => source.status === "failed" || source.status === "partial",
      )
        ? "partial"
        : "ready",
      count: runsResult.value.items.length,
      ...(runsResult.value.nextCursor ? { hasMore: true as const } : {}),
    };
  }

  return { automations, runs };
}
