"use client";

import type { AgentLoopWatchdogRun } from "@/lib/db/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * PausedDiagnosisBanner — M3-02-B
 *
 * Renders when run.status === 'paused' AND at least one watchdog run exists.
 * Uses the LATEST watchdog run by createdAt.
 *
 * Visual: amber card (attention, not error). Placement: below RunActions,
 * above the generic error banner.
 */
export function PausedDiagnosisBanner({
  watchdogRuns,
}: {
  watchdogRuns: AgentLoopWatchdogRun[];
}) {
  if (watchdogRuns.length === 0) return null;

  // Use the latest by createdAt
  const latest = [...watchdogRuns].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];

  if (!latest) return null;

  const isInFlight = latest.status === "running" || latest.status === "pending";

  return (
    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        {isInFlight
          ? "Watchdog is analyzing this run…"
          : "Watchdog paused this run"}
      </p>
      {!isInFlight && latest.diagnosis && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          {latest.diagnosis}
        </p>
      )}
      {!isInFlight && (
        <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
          Decision: {latest.decision ? capitalize(latest.decision) : "—"}
          {" · "}
          Node {latest.nodeId}
          {" · "}
          Budget remaining {latest.budgetRemaining}
        </p>
      )}
    </div>
  );
}
