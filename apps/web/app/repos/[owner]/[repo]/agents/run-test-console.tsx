"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useBackgroundRunPolling } from "./use-background-run-polling";

/**
 * Inline live console that polls a background agent run and renders events
 * as console lines. Mounts directly below the action bar in the spec editor.
 */

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

function formatEventTime(isoString: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(isoString));
}

function RunStatusIndicator({ status }: { status: string }) {
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-xs font-medium capitalize">succeeded</span>
      </span>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
        <XCircle className="h-4 w-4" />
        <span className="text-xs font-medium capitalize">{status}</span>
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <span className="text-xs font-medium capitalize">skipped</span>
      </span>
    );
  }
  // queued or running — active
  return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-xs font-medium capitalize">{status}</span>
    </span>
  );
}

type RunTestConsoleProps = {
  runId: string;
};

export function RunTestConsole({ runId }: RunTestConsoleProps) {
  const { data, error } = useBackgroundRunPolling(runId);

  if (error) {
    return (
      <div className="mt-3 rounded-md border border-red-500/25 bg-red-50/30 px-3 py-2 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-400">
        Failed to load run:{" "}
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-3 rounded-md border border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
        Loading run…
      </div>
    );
  }

  const { run, events } = data;
  const isActive = !TERMINAL_STATUSES.has(run.status);
  const hasError = run.status === "failed" && Boolean(run.errorMessage);

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Test run
          </span>
          <RunStatusIndicator status={run.status} />
        </div>
        <Link
          href={`/background-runs/${runId}`}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Open full run
        </Link>
      </div>

      {/* Error banner — shown when run failed with a message */}
      {hasError && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-50/50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400"
        >
          Test failed — {run.errorMessage}
        </div>
      )}

      {/* Console body */}
      <div className="max-h-64 overflow-y-auto p-3 font-mono text-[11px]">
        {events.length === 0 ? (
          <p className="text-muted-foreground">
            {isActive ? "Waiting for events…" : "No events recorded."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {/* API returns events newest-first; reverse so the console reads
                chronologically with the latest line at the bottom. */}
            {[...events].toReversed().map((event) => (
              <li key={event.id} className="flex flex-wrap gap-2">
                <span className="shrink-0 text-muted-foreground">
                  [{formatEventTime(event.createdAt)}]
                </span>
                <span
                  className={
                    event.status === "failed"
                      ? "text-red-600 dark:text-red-400"
                      : event.status === "succeeded"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-muted-foreground"
                  }
                >
                  {event.status}
                </span>
                <span className="text-foreground">{event.eventName}</span>
                {event.summary && (
                  <span className="text-muted-foreground">{event.summary}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
