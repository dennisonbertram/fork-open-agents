/**
 * Schedule preset definitions, next-run computation, and schedule validation.
 * Pure helpers — no DB access.
 */
import { scheduleMatchesNow } from "./schedule";

export type SchedulePreset = {
  label: string;
  value: string | null;
};

/**
 * Named schedule presets that map to cron strings.
 * The "Custom cron" preset has a null value — the user supplies their own.
 */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: "Hourly", value: "@hourly" },
  { label: "Daily (morning)", value: "0 9 * * *" },
  { label: "Weekdays (morning)", value: "0 9 * * 1-5" },
  { label: "Weekly", value: "@weekly" },
  { label: "Custom cron", value: null },
];

export type ScheduleValidationResult =
  | { valid: true }
  | { valid: false; error: string };

const SUPPORTED_GRAMMAR_MESSAGE =
  "Supported formats: @hourly, @daily, @weekly, or a 5-field cron expression (minute hour day month weekday). Example: 0 9 * * 1-5";

/**
 * Validates whether a schedule string matches the supported grammar.
 * Returns { valid: true } for valid expressions, { valid: false, error } for invalid.
 */
export function validateSchedule(
  schedule: string | null | undefined,
): ScheduleValidationResult {
  if (!schedule || schedule.trim() === "") {
    return {
      valid: false,
      error: `Schedule is required. ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }

  const normalized = schedule.trim();

  if (
    normalized === "@hourly" ||
    normalized === "@daily" ||
    normalized === "@weekly"
  ) {
    return { valid: true };
  }

  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error: `Invalid schedule expression: ${JSON.stringify(normalized)} has ${fields.length} field(s) but requires exactly 5. ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  if (!isValidCronField(minute ?? "", 0, 59)) {
    return {
      valid: false,
      error: `Invalid minute field ${JSON.stringify(minute)} (must be 0-59). ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }
  if (!isValidCronField(hour ?? "", 0, 23)) {
    return {
      valid: false,
      error: `Invalid hour field ${JSON.stringify(hour)} (must be 0-23). ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }
  if (!isValidCronField(dayOfMonth ?? "", 1, 31)) {
    return {
      valid: false,
      error: `Invalid day-of-month field ${JSON.stringify(dayOfMonth)} (must be 1-31). ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }
  if (!isValidCronField(month ?? "", 1, 12)) {
    return {
      valid: false,
      error: `Invalid month field ${JSON.stringify(month)} (must be 1-12). ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }
  if (!isValidCronField(dayOfWeek ?? "", 0, 6)) {
    return {
      valid: false,
      error: `Invalid day-of-week field ${JSON.stringify(dayOfWeek)} (must be 0-6). ${SUPPORTED_GRAMMAR_MESSAGE}`,
    };
  }

  return { valid: true };
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;

  if (field.includes(",")) {
    return field
      .split(",")
      .every((part) => isValidCronField(part.trim(), min, max));
  }

  if (field.startsWith("*/")) {
    const step = Number.parseInt(field.slice(2), 10);
    return Number.isInteger(step) && step >= 1 && step <= max;
  }

  if (field.includes("-")) {
    const parts = field.split("-");
    if (parts.length !== 2) return false;
    const [startRaw, endRaw] = parts;
    const start = Number.parseInt(startRaw ?? "", 10);
    const end = Number.parseInt(endRaw ?? "", 10);
    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= min &&
      end <= max &&
      start <= end
    );
  }

  const exact = Number.parseInt(field, 10);
  return Number.isInteger(exact) && exact >= min && exact <= max;
}

/**
 * Compute the next N UTC dates that match the given schedule, starting
 * strictly AFTER fromDate. Returns an empty array for invalid schedules.
 *
 * This function advances minute-by-minute through time — suitable for UI
 * preview use cases (computing 3 future runs). It is pure and has no
 * side-effects.
 */
export function computeNextRuns(
  schedule: string | null | undefined,
  fromDate: Date,
  count: number,
): Date[] {
  if (!schedule || schedule.trim() === "") {
    return [];
  }

  const validation = validateSchedule(schedule);
  if (!validation.valid) {
    return [];
  }

  const results: Date[] = [];
  // Start scanning from the next minute after fromDate
  const candidate = new Date(fromDate);
  // Advance to the next minute boundary (exclusive of the current minute)
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Safety cap: scan at most 60 * 24 * 366 = 527,040 minutes (~1 year)
  const maxIterations = 527_040;
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    if (scheduleMatchesNow(schedule, candidate)) {
      results.push(new Date(candidate));
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
    iterations++;
  }

  return results;
}
