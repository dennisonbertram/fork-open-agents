/**
 * AgentScheduleCard — displays last-run, next-run, and status
 * from persisted schedule trigger state.
 */

import { formatRunTimestamp } from "@/lib/date/format-run-timestamp";

type ScheduleTriggerState = {
  id: string;
  schedule: string | null;
  status: "enabled" | "disabled";
  lastRunAt: string | Date | null;
  nextRunAt: string | Date | null;
  lastSkipReason: string | null;
};

type AgentScheduleCardProps = {
  trigger: ScheduleTriggerState;
};

/**
 * Card showing schedule trigger state: last run, next run, skip reasons.
 */
export function AgentScheduleCard({ trigger }: AgentScheduleCardProps) {
  if (trigger.status === "disabled") {
    return (
      <div className="rounded border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Schedule trigger is disabled.
      </div>
    );
  }

  if (!trigger.schedule) {
    return (
      <div className="rounded border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        No schedule configured.
      </div>
    );
  }

  if (trigger.lastSkipReason) {
    return (
      <div className="space-y-1 rounded border border-amber-500/20 bg-amber-50/30 px-3 py-2 text-xs dark:bg-amber-950/20">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          Last invocation skipped
        </p>
        <p className="text-amber-600 dark:text-amber-500">
          {trigger.lastSkipReason}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 rounded border border-border bg-muted/10 px-3 py-2 text-xs">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Last run
        </p>
        <p className="mt-0.5 text-foreground">
          {formatRunTimestamp(trigger.lastRunAt, { fallback: "Never" })}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Next run
        </p>
        <p className="mt-0.5 text-foreground">
          {formatRunTimestamp(trigger.nextRunAt, { fallback: "Never" })}
        </p>
      </div>
    </div>
  );
}
