/**
 * schedule-truth-line.ts — loop-detail's schedule-truth statement (#767),
 * derived from the Triggers card data (#762 GET returns nextRunAt +
 * humanizedSchedule per trigger):
 *   - "Next run: <time> UTC" when an enabled schedule trigger exists
 *   - "No schedule — runs only when you press Run now." otherwise
 *
 * A loop must also be active for its triggers to fire — when a schedule
 * trigger exists but the loop isn't active, the line notes that instead of
 * implying the schedule alone is enough.
 */

export type ScheduleTruthTrigger = {
  kind: string;
  status: string;
  nextRunAt?: Date | string | null;
};

const NO_SCHEDULE_LINE = "No schedule — runs only when you press Run now.";

function formatNextRunUtc(value: Date | string): string {
  return `${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

/**
 * Returns the schedule-truth line for the loop detail page.
 */
export function getScheduleTruthLine(params: {
  loopStatus: string;
  triggers: ScheduleTruthTrigger[];
}): string {
  const enabledSchedule = params.triggers.find(
    (t) => t.kind === "schedule" && t.status === "enabled" && t.nextRunAt,
  );

  if (!enabledSchedule) {
    return NO_SCHEDULE_LINE;
  }

  if (params.loopStatus !== "active") {
    return "This loop has a schedule, but it won't fire until the loop is Active.";
  }

  return `Next run: ${formatNextRunUtc(enabledSchedule.nextRunAt as Date | string)}`;
}
