"use client";

import { Clock3, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentLoopWatchdogRun } from "@/lib/db/schema";
import { formatRunTimestamp } from "@/lib/date/format-run-timestamp";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value: Date | string | null): string {
  return formatRunTimestamp(value, { includeSeconds: true });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * WatchdogRow — M3-02-B
 *
 * Renders a single watchdog run entry interleaved in the Step timeline.
 * Violet-tinted to read as a distinct 'watchdog' lane.
 *
 * - retry decision → emerald/info treatment (recovery path)
 * - pause decision → amber treatment (needs attention)
 * - in-flight (status=running/pending) → neutral with 'analyzing…' label
 * - diagnosis visible in collapsible <details> (mirrors StepRow output pattern)
 */
export function WatchdogRow({
  watchdogRun,
}: {
  watchdogRun: AgentLoopWatchdogRun;
}) {
  const isInFlight =
    watchdogRun.status === "running" || watchdogRun.status === "pending";
  const decisionLabel = isInFlight
    ? "Analyzing…"
    : watchdogRun.decision
      ? capitalize(watchdogRun.decision)
      : "—";

  return (
    <div
      className={cn(
        "grid gap-2 px-4 py-3",
        "bg-violet-500/5 ring-1 ring-inset ring-violet-500/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert
            className="h-3.5 w-3.5 shrink-0 text-violet-500"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              Watchdog: {decisionLabel}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {watchdogRun.nodeId}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
            isInFlight
              ? "border-border bg-muted/40 text-muted-foreground"
              : watchdogRun.decision === "retry"
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : watchdogRun.decision === "pause"
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {watchdogRun.status}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>attempt {watchdogRun.attempt}</span>
        <span>·</span>
        <span>budget remaining {watchdogRun.budgetRemaining}</span>
        <span>·</span>
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        <span>{formatDate(watchdogRun.createdAt)}</span>
      </div>
      {watchdogRun.diagnosis && (
        <details className="rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">
            Diagnosis
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed">
            {watchdogRun.diagnosis}
          </p>
        </details>
      )}
    </div>
  );
}
