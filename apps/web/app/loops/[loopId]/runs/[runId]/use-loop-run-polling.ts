/**
 * useLoopRunPolling — SWR refresh-interval calculator for loop run pages
 *
 * Active statuses (queued, running, paused) poll every 2 seconds.
 * Terminal statuses (completed, failed, cancelled, stalled) stop polling (0).
 * Undefined status also returns 0.
 */
import useSWR from "swr";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);
const POLL_INTERVAL_MS = 2000;

/**
 * Pure function that computes the SWR refreshInterval for a given run status.
 * Exported for direct unit testing.
 */
export function computeLoopRunRefreshInterval(
  status: string | undefined,
): number {
  if (!status) return 0;
  return ACTIVE_STATUSES.has(status) ? POLL_INTERVAL_MS : 0;
}

async function fetchRunDetail(
  url: string,
): Promise<GetAgentLoopRunDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load run detail");
  }
  return res.json() as Promise<GetAgentLoopRunDetailResponse>;
}

/**
 * SWR hook that polls /api/agent-loop-runs/[runId] while the run is active
 * and stops automatically on terminal status.
 */
export function useLoopRunPolling(
  runId: string,
  initialData: GetAgentLoopRunDetailResponse,
) {
  return useSWR<GetAgentLoopRunDetailResponse>(
    `/api/agent-loop-runs/${runId}`,
    fetchRunDetail,
    {
      fallbackData: initialData,
      refreshInterval: (latest) =>
        computeLoopRunRefreshInterval(latest?.run.status),
    },
  );
}

/**
 * The SWR key for a loop's runs list (loop-detail.tsx). Exported so
 * run-detail.tsx can revalidate it after a control action (pause/resume/
 * cancel/retry) — otherwise the runs list and this run-detail page can show
 * contradictory statuses for the same run until the list's own polling
 * interval catches up (walk-3 finding, #767).
 */
export function loopRunsListSwrKey(loopId: string): string {
  return `/api/agent-loops/${loopId}/runs`;
}
