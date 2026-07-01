"use client";

import {
  computeNextRuns,
  validateSchedule,
} from "@/lib/background-agents/schedule-presets";

type SchedulePreviewProps = {
  schedule: string | null | undefined;
  fromDate: Date;
  label?: string;
};

/**
 * Renders the next 3 upcoming run times for a schedule expression.
 * Renders nothing for null/undefined schedules.
 * Renders a validation error for invalid schedules.
 */
export function SchedulePreview({
  schedule,
  fromDate,
  label = "Next 3 runs",
}: SchedulePreviewProps) {
  if (!schedule) {
    return null;
  }

  const validation = validateSchedule(schedule);
  if (!validation.valid) {
    return (
      <p className="text-xs text-red-600 dark:text-red-400">
        Invalid schedule: {validation.error}
      </p>
    );
  }

  const runs = computeNextRuns(schedule, fromDate, 3);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label} (UTC)</p>
      <ul className="space-y-0.5">
        {runs.map((run, i) => (
          <li key={i} className="text-xs text-foreground">
            {formatUtcTime(run)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders an inline validation error message for an invalid schedule.
 * Renders nothing for valid schedules or empty strings (not-yet-entered).
 */
export function ScheduleValidationMessage({
  schedule,
}: {
  schedule: string | null | undefined;
}) {
  if (!schedule || schedule.trim() === "") {
    return null;
  }

  const validation = validateSchedule(schedule);
  if (validation.valid) {
    return null;
  }

  return (
    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
      {validation.error}
    </p>
  );
}

/**
 * Formats a date in UTC. Schedule expressions (cron) are evaluated in UTC
 * (see schedule.ts / schedule-presets.ts), so preview times must be labeled
 * and rendered in UTC to avoid misleading the user about when a run will
 * actually fire.
 */
function formatUtcTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
