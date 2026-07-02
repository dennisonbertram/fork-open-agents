/**
 * useBackgroundRunPolling — SWR refresh-interval polling hook for background agent run detail pages.
 *
 * Active statuses (queued, running) poll every 2 seconds.
 * Terminal statuses (succeeded, failed, skipped, cancelled) stop polling (0).
 * Undefined status returns 0.
 */
import useSWR from "swr";

type SerializedBackgroundEvent = {
  id: string;
  eventName: string;
  status: string;
  summary: string | null;
  workflowRunId: string | null;
  sandboxName: string | null;
  requestId: string | null;
  errorKind: string | null;
  redactionStatus: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type SerializedBackgroundOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  prNumber: number | null;
};

export type BackgroundRunDetailResponse = {
  run: {
    id: string;
    status: string;
    repoOwner: string;
    repoName: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorKind: string | null;
    errorMessage: string | null;
    outputUrl: string | null;
    sandboxName: string | null;
    requestId: string | null;
    workflowRunId: string | null;
  };
  agent: {
    id: string;
    name: string;
    permissions: unknown;
    checkCommand: string | null;
  } | null;
  events: SerializedBackgroundEvent[];
  outputs: SerializedBackgroundOutput[];
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const POLL_INTERVAL_MS = 2000;

/**
 * Pure function that computes the SWR refreshInterval for a given run status.
 * Exported for direct unit testing.
 */
export function computeBackgroundRunRefreshInterval(
  status: string | undefined,
): number {
  if (!status) return 0;
  return ACTIVE_STATUSES.has(status) ? POLL_INTERVAL_MS : 0;
}

async function fetchRunDetail(
  url: string,
): Promise<BackgroundRunDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load run detail");
  }
  return res.json() as Promise<BackgroundRunDetailResponse>;
}

/**
 * SWR hook that polls /api/background-agent-runs/{runId} while the run is active
 * and stops automatically on terminal status.
 */
export function useBackgroundRunPolling(runId: string) {
  return useSWR<BackgroundRunDetailResponse>(
    `/api/background-agent-runs/${runId}`,
    fetchRunDetail,
    {
      refreshInterval: (latest) =>
        computeBackgroundRunRefreshInterval(latest?.run.status),
    },
  );
}
