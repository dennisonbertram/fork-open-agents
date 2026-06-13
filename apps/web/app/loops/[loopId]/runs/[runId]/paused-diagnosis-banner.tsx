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
 * Renders when run.status === 'paused' AND the latest DECIDED watchdog row
 * has decision === 'pause'. This prevents false attribution when the run was
 * paused by the operator after the watchdog issued a 'retry' decision, or
 * when only in-flight (pending/running) watchdog rows exist.
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

  // Sort all rows newest-first
  const sorted = [...watchdogRuns].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const latestRow = sorted[0];
  if (!latestRow) return null;

  // If the latest row is in-flight (pending/running), show the analyzing state.
  const isInFlight =
    latestRow.status === "running" || latestRow.status === "pending";

  if (isInFlight) {
    return (
      <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Watchdog is analyzing this run…
        </p>
      </div>
    );
  }

  // Only show the 'Watchdog paused this run' banner when the latest DECIDED
  // row's decision is 'pause'. A 'retry' or 'skip' decision means the watchdog
  // chose to continue, so any subsequent pause was operator-initiated — showing
  // 'Watchdog paused this run' would be a false attribution.
  const latestDecidedRow = sorted.find((r) => r.status === "decided");
  if (!latestDecidedRow || latestDecidedRow.decision !== "pause") return null;

  return (
    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        Watchdog paused this run
      </p>
      {latestDecidedRow.diagnosis && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          {latestDecidedRow.diagnosis}
        </p>
      )}
      <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
        Decision: {capitalize(latestDecidedRow.decision)}
        {" · "}
        Node {latestDecidedRow.nodeId}
        {" · "}
        Budget remaining {latestDecidedRow.budgetRemaining}
      </p>
    </div>
  );
}
