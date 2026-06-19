"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import { DashboardStatusPill } from "./dashboard-status-pill";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "stalled";

export type RunRow = {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

type RunsResponse = { runs: RunRow[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the SWR cache key for the loop runs endpoint.
 * Returns null when not yet expanded — SWR treats null as "do not fetch".
 * Exported for unit testing.
 */
export function buildSwrKey(loopId: string, expanded: boolean): string | null {
  if (!expanded) return null;
  return `/api/agent-loops/${loopId}/runs?limit=3`;
}

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt) return "-";
  if (!finishedAt) return "Running";
  const ms = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const ms = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Sub-components (exported for targeted tests) ───────────────────────────────

/**
 * The collapsed trigger button (aria-expanded=false).
 * Exported so tests can render just the collapsed state without the full
 * stateful wrapper.
 */
export function LoopRunPreviewCollapsed({
  loopId: _loopId,
  onClick,
}: {
  loopId: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label="Show recent runs"
      onClick={onClick}
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronRight
        aria-hidden="true"
        className="h-3 w-3 shrink-0 transition-transform"
      />
      <span>Runs</span>
    </button>
  );
}

/**
 * The expanded trigger button (aria-expanded=true).
 * Exported so tests can render just the expanded state.
 */
export function LoopRunPreviewExpanded({
  loopId: _loopId,
  onClick,
}: {
  loopId: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={true}
      aria-label="Hide recent runs"
      onClick={onClick}
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronRight
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rotate-90 transition-transform"
      />
      <span>Runs</span>
    </button>
  );
}

/**
 * The body that renders loading skeleton, run rows, empty state, or error.
 * Exported for targeted unit tests — receives resolved data so no SWR needed.
 */
export function LoopRunPreviewBody({
  loopId,
  isLoading,
  runs,
  error,
}: {
  loopId: string;
  isLoading: boolean;
  runs: RunRow[] | undefined;
  error: Error | undefined;
}) {
  if (isLoading || (runs === undefined && error === undefined)) {
    // 3 skeleton rows
    return (
      <div className="mt-1 space-y-1.5 pl-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse flex items-center gap-2"
            aria-label="skeleton"
          >
            <div className="skeleton h-4 w-14 rounded-full bg-muted/60" />
            <div className="skeleton h-3 w-16 rounded bg-muted/40" />
            <div className="skeleton h-3 w-10 rounded bg-muted/40" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-1 pl-4 text-xs text-red-600 dark:text-red-400">
        Could not load runs. Please try again.
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="mt-1 pl-4 text-xs text-muted-foreground">No runs yet</div>
    );
  }

  return (
    <div className="mt-1 space-y-1 pl-4">
      {runs.slice(0, 3).map((run) => (
        <Link
          key={run.id}
          href={`/loops/${loopId}/runs/${run.id}`}
          className={cn(
            "flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors",
            "hover:bg-muted/30",
          )}
        >
          <DashboardStatusPill status={run.status} />
          <span className="text-muted-foreground">
            {formatRelativeTime(run.startedAt ?? run.createdAt)}
          </span>
          <span className="text-muted-foreground">
            {formatDuration(run.startedAt, run.finishedAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

// ── Main stateful component ───────────────────────────────────────────────────

/**
 * Row-level disclosure that reveals the 3 most recent runs for a loop.
 *
 * - Renders a chevron trigger button (collapsed by default)
 * - On FIRST expand, fires a SWR fetch to GET /api/agent-loops/[loopId]/runs?limit=3
 * - No fetch is issued until the user expands the disclosure
 * - Shows 3 skeleton rows while loading
 * - Renders run rows: status pill, relative start time, duration, link to run page
 * - Empty and error states handled gracefully
 */
export function LoopRunPreview({ loopId }: { loopId: string }) {
  const [expanded, setExpanded] = useState(false);

  // SWR key is null until the user expands — prevents any network request
  // on initial render. Once non-null (after expand), SWR fetches and caches.
  const swrKey = buildSwrKey(loopId, expanded);
  const { data, error, isLoading } = useSWR<RunsResponse>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div>
      {expanded ? (
        <LoopRunPreviewExpanded loopId={loopId} onClick={toggle} />
      ) : (
        <LoopRunPreviewCollapsed loopId={loopId} onClick={toggle} />
      )}
      {expanded && (
        <LoopRunPreviewBody
          loopId={loopId}
          isLoading={isLoading}
          runs={data?.runs}
          error={error as Error | undefined}
        />
      )}
    </div>
  );
}
