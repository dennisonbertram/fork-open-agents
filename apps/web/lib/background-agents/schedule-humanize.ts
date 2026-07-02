/**
 * Plain-language cron rendering with an explicit UTC label (#762).
 *
 * Generalizes the partial humanizer already in
 * app/repos/[owner]/[repo]/agents/schedule-visual.tsx (describeSchedule),
 * which only covers the builder-expressible cases (hourly/daily/weekly) and
 * is a client component. This module is a pure, server-safe function that
 * also produces a readable label for schedules the builder can't parse
 * (arbitrary cron expressions), so it can back both the loop-trigger API
 * response (server) and the Triggers card UI (client).
 *
 * No new dependency — reuses parseCron (schedule-builder.ts) and
 * validateSchedule (schedule-presets.ts), the same primitives the existing
 * background-agents schedule UI is built on.
 */
import { parseCron } from "./schedule-builder";
import { validateSchedule } from "./schedule-presets";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function describeWeekdays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (
    sorted.length === WEEKDAYS_MON_FRI.length &&
    sorted.every((d, i) => d === WEEKDAYS_MON_FRI[i])
  ) {
    return "on weekdays";
  }
  return `on ${sorted.map((d) => WEEKDAY_NAMES[d]).join(", ")}`;
}

/**
 * Renders a schedule expression in plain language, always including an
 * explicit "UTC" label since cron schedules are evaluated in UTC.
 *
 * Returns "" for null/empty schedules (nothing to render), or an
 * "Invalid schedule: ..." message for expressions that fail validation.
 */
export function humanizeSchedule(schedule: string | null | undefined): string {
  if (!schedule || schedule.trim() === "") {
    return "";
  }

  const validation = validateSchedule(schedule);
  if (!validation.valid) {
    return `Invalid schedule: ${validation.error}`;
  }

  const parsed = parseCron(schedule);
  if (parsed) {
    if (parsed.frequency === "hourly") {
      return `Every hour at :${two(parsed.minute)} (UTC)`;
    }
    if (parsed.frequency === "daily") {
      return `Every day at ${two(parsed.hour)}:${two(parsed.minute)} UTC`;
    }
    if (parsed.frequency === "weekly") {
      return `Every week ${describeWeekdays(parsed.weekdays)} at ${two(
        parsed.hour,
      )}:${two(parsed.minute)} UTC`;
    }
  }

  // Custom/non-builder-expressible cron — still give a plain-language label
  // instead of showing only the raw cron string, per #762's copy ban on
  // "cron" alone (must always pair with humanized text + UTC note).
  return `Custom schedule (${schedule.trim()}, UTC)`;
}
