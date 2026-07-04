/**
 * useLoopRunPolling — SWR refresh-interval calculator for loop run pages
 *
 * Active statuses (queued, running, paused) poll every 2 seconds.
 * Terminal statuses (completed, failed, cancelled, stalled) stop polling (0).
 * Undefined status also returns 0.
 *
 * #880 — production evidence showed a hung poll fetch (stuck "pending")
 * freezes ALL subsequent polling ticks forever: SWR's refreshInterval
 * scheduling only queues the next tick after the current revalidation
 * settles, so a fetch that never resolves wedges the page's snapshot while
 * the UI kept claiming "Refreshing every 2s". The fetcher now races against
 * a timeout and aborts the in-flight request, and the hook tracks
 * time-since-last-success so the UI can honestly show staleness instead of
 * a false liveness claim.
 */
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { getLoopRunLiveness, type LoopRunLiveness } from "./run-liveness";

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);
const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 10_000;

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

/**
 * A minimal fetch-shaped function. Deliberately narrower than `typeof fetch`
 * (which includes Bun's `preconnect` static) so injected test stubs and
 * plain `(input, init) => fetch(input, init)` wrappers satisfy it.
 */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const defaultFetchImpl: FetchLike = (input, init) => fetch(input, init);

/**
 * Fetches run detail with a hard timeout: races the request against a
 * timer that both rejects AND aborts the in-flight fetch's signal, so a
 * hung/never-resolving response (the observed production pathology) can
 * never wedge the caller — it always settles within timeoutMs.
 */
export async function fetchRunDetailWithTimeout(
  url: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<GetAgentLoopRunDetailResponse> {
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`Run detail poll timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const res = await Promise.race([
      fetchImpl(url, { signal: controller.signal }),
      timeoutPromise,
    ]);
    if (!res.ok) {
      throw new Error("Failed to load run detail");
    }
    return (await res.json()) as GetAgentLoopRunDetailResponse;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

export type UseLoopRunPollingOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  refreshIntervalMs?: number;
  dedupingIntervalMs?: number;
  errorRetryIntervalMs?: number;
  staleAfterMs?: number;
  nowTickMs?: number;
};

export type UseLoopRunPollingResult = {
  data: GetAgentLoopRunDetailResponse | undefined;
  error: unknown;
  liveness: LoopRunLiveness;
};

/**
 * SWR hook that polls /api/agent-loop-runs/[runId] while the run is active
 * and stops automatically on terminal status.
 */
export function useLoopRunPolling(
  runId: string,
  initialData: GetAgentLoopRunDetailResponse,
  options: UseLoopRunPollingOptions = {},
): UseLoopRunPollingResult {
  const [lastSuccessAtMs, setLastSuccessAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const swr = useSWR<GetAgentLoopRunDetailResponse>(
    `/api/agent-loop-runs/${runId}`,
    (url: string) =>
      fetchRunDetailWithTimeout(url, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    {
      fallbackData: initialData,
      refreshInterval: (latest) => {
        const base = computeLoopRunRefreshInterval(latest?.run.status);
        return base === 0 ? 0 : (options.refreshIntervalMs ?? base);
      },
      errorRetryInterval: options.errorRetryIntervalMs ?? POLL_INTERVAL_MS,
      ...(options.dedupingIntervalMs !== undefined
        ? { dedupingInterval: options.dedupingIntervalMs }
        : {}),
      onSuccess: () => setLastSuccessAtMs(Date.now()),
    },
  );

  const status = swr.data?.run.status ?? initialData.run.status;
  const isActive = computeLoopRunRefreshInterval(status) > 0;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, options.nowTickMs ?? 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, options.nowTickMs]);

  const liveness = getLoopRunLiveness({
    isActive,
    lastSuccessAtMs,
    nowMs,
    staleAfterMs: options.staleAfterMs,
  });

  return { data: swr.data, error: swr.error, liveness };
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
