"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import type { RunsListResponse } from "@/lib/runs/list";
import type { RunState } from "@/lib/runs/types";

const POLL_INTERVAL_MS = 5000;
const POLL_DEADLINE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export type RunsFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RunsFetchError = Error & { data?: RunsListResponse };

export function computeRunsRefreshInterval(
  runs: Array<{ state: RunState }> | undefined,
  nowMs: number,
  deadlineAtMs: number,
): number {
  if (nowMs >= deadlineAtMs) return 0;
  return runs?.some((run) => run.state === "queued" || run.state === "running")
    ? POLL_INTERVAL_MS
    : 0;
}

export function shouldShowRunsPollingPaused(
  runs: Array<{ state: RunState }> | undefined,
  deadlineReached: boolean,
): boolean {
  return (
    deadlineReached &&
    Boolean(
      runs?.some((run) => run.state === "queued" || run.state === "running"),
    )
  );
}

export async function fetchRunsWithTimeout(
  url: string,
  options: { fetchImpl?: RunsFetchLike; timeoutMs?: number } = {},
): Promise<RunsListResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Runs request timed out"));
    }, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, { signal: controller.signal }),
      timeoutPromise,
    ]);
    const data = (await response.json().catch(() => undefined)) as
      | RunsListResponse
      | undefined;
    if (!response.ok) {
      throw Object.assign(new Error("Runs sources unavailable"), { data });
    }
    if (!data) throw new Error("Runs response was empty");
    return data;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function useRunsList(searchParams: string) {
  const [deadlineAtMs] = useState(() => Date.now() + POLL_DEADLINE_MS);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const apiUrl = `/api/runs${searchParams ? `?${searchParams}` : ""}`;
  const refreshInterval = useCallback(
    (latest: RunsListResponse | undefined) =>
      computeRunsRefreshInterval(latest?.items, Date.now(), deadlineAtMs),
    [deadlineAtMs],
  );
  const swr = useSWR<RunsListResponse, RunsFetchError>(
    apiUrl,
    fetchRunsWithTimeout,
    { refreshInterval },
  );
  const hasActiveRuns = Boolean(
    swr.data?.items.some(
      (run) => run.state === "queued" || run.state === "running",
    ),
  );

  useEffect(() => {
    if (!hasActiveRuns) {
      setDeadlineReached(false);
      return;
    }
    const delay = Math.max(deadlineAtMs - Date.now(), 0);
    const timer = window.setTimeout(() => setDeadlineReached(true), delay);
    return () => window.clearTimeout(timer);
  }, [deadlineAtMs, hasActiveRuns]);

  return {
    ...swr,
    apiUrl,
    pollingPaused: shouldShowRunsPollingPaused(
      swr.data?.items,
      deadlineReached,
    ),
  };
}
