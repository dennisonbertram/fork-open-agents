import {
  buildRunsQueryKey,
  encodeRunsCursor,
  type RunsCursor,
  type RunsFilters,
} from "./query";
import type { AutomationRunSource, NormalizedAutomationRun } from "./types";

export interface RunsSourceQuery {
  filters: RunsFilters;
  limit: number;
  cursor?: RunsCursor;
  now: Date;
}

export type RunsSourceLoader = (
  query: RunsSourceQuery,
) => Promise<NormalizedAutomationRun[]>;

export type RunsSourceLoaders = Record<AutomationRunSource, RunsSourceLoader>;

export interface RunsSourceStatus {
  source: AutomationRunSource;
  status: "ok" | "partial" | "failed";
  itemCount: number;
  safeErrorKind?: "source_unavailable";
}

export interface RunsListResponse {
  requestId: string;
  generatedAt: string;
  items: NormalizedAutomationRun[];
  sourceStatus: RunsSourceStatus[];
  nextCursor?: string;
  allSourcesFailed: boolean;
}

const sourceOrder: AutomationRunSource[] = ["background_agent", "agent_loop"];

function compareRuns(
  left: NormalizedAutomationRun,
  right: NormalizedAutomationRun,
): number {
  const timestampDelta =
    new Date(right.timestamps.createdAt).getTime() -
    new Date(left.timestamps.createdAt).getTime();
  return timestampDelta !== 0
    ? timestampDelta
    : right.id.localeCompare(left.id);
}

export async function listAutomationRuns(params: {
  requestId: string;
  filters: RunsFilters;
  limit: number;
  cursor?: RunsCursor;
  loaders: RunsSourceLoaders;
  now?: Date;
}): Promise<RunsListResponse> {
  const now = params.now ?? new Date();
  const selectedSources = params.filters.automationSource
    ? [params.filters.automationSource]
    : sourceOrder;
  const settled = await Promise.all(
    selectedSources.map(async (source) => {
      try {
        const items = await params.loaders[source]({
          filters: params.filters,
          limit: params.limit + 1,
          cursor: params.cursor,
          now,
        });
        return {
          source,
          items,
          status: {
            source,
            status: "ok" as const,
            itemCount: items.length,
          },
        };
      } catch {
        console.error("[runs]", {
          requestId: params.requestId,
          source,
          action: "list_runs",
          errorKind: "source_unavailable",
        });
        return {
          source,
          items: [],
          status: {
            source,
            status: "failed" as const,
            itemCount: 0,
            safeErrorKind: "source_unavailable" as const,
          },
        };
      }
    }),
  );
  const hasFailure = settled.some(
    (result) => result.status.status === "failed",
  );
  const allSourcesFailed = settled.every(
    (result) => result.status.status === "failed",
  );
  const merged = settled.flatMap((result) => result.items).sort(compareRuns);
  const items = merged.slice(0, params.limit);
  const lastItem = items.at(-1);
  const nextCursor =
    !hasFailure && merged.length > params.limit && lastItem
      ? encodeRunsCursor({
          createdAt: lastItem.timestamps.createdAt,
          id: lastItem.id,
          queryKey: buildRunsQueryKey(params.filters),
        })
      : undefined;

  return {
    requestId: params.requestId,
    generatedAt: now.toISOString(),
    items,
    sourceStatus: settled.map((result) => result.status),
    ...(nextCursor ? { nextCursor } : {}),
    allSourcesFailed,
  };
}
