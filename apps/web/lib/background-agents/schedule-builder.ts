/**
 * Pure helpers that translate between a human-friendly schedule "builder" state
 * (frequency + time-of-day + weekdays) and the 5-field cron strings the rest of
 * the background-agents system understands.
 *
 * The builder intentionally only represents the common cases (hourly / daily /
 * weekly at a chosen time). Anything it cannot represent round-trips through the
 * `custom` frequency, which carries a raw cron expression verbatim. No DB or I/O.
 */

export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "custom";

export type ScheduleBuilderState = {
  frequency: ScheduleFrequency;
  /** Minute of the hour, 0-59. Used by hourly/daily/weekly. */
  minute: number;
  /** Hour of the day, 0-23. Used by daily/weekly. */
  hour: number;
  /** Days of week, 0 (Sun) - 6 (Sat). Used by weekly. */
  weekdays: number[];
  /** Raw cron expression, used only when frequency === "custom". */
  customExpression: string;
};

export function defaultScheduleBuilderState(): ScheduleBuilderState {
  return {
    frequency: "hourly",
    minute: 0,
    hour: 9,
    weekdays: [1],
    customExpression: "",
  };
}

/** Compose a 5-field cron string from builder state. */
export function composeCron(state: ScheduleBuilderState): string {
  switch (state.frequency) {
    case "hourly":
      return `${state.minute} * * * *`;
    case "daily":
      return `${state.minute} ${state.hour} * * *`;
    case "weekly": {
      const days =
        state.weekdays.length > 0
          ? [...state.weekdays].sort((a, b) => a - b)
          : [1];
      return `${state.minute} ${state.hour} * * ${days.join(",")}`;
    }
    case "custom":
      return state.customExpression;
    default:
      return state.customExpression;
  }
}

const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
};

function parseIntStrict(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

/** Parse a weekday field (single, comma list, or range) into sorted day numbers. */
function parseWeekdays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [startRaw, endRaw, ...rest] = part.split("-");
      if (rest.length > 0) {
        return null;
      }
      const start = parseIntStrict(startRaw ?? "");
      const end = parseIntStrict(endRaw ?? "");
      if (start === null || end === null || start > end || end > 6) {
        return null;
      }
      for (let d = start; d <= end; d++) {
        days.add(d);
      }
    } else {
      const day = parseIntStrict(part);
      if (day === null || day > 6) {
        return null;
      }
      days.add(day);
    }
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}

/**
 * Parse a cron string into builder state, or return null when the expression is
 * outside what the builder can represent (the caller should fall back to the
 * `custom` frequency carrying the raw string).
 */
export function parseCron(
  schedule: string | null | undefined,
): ScheduleBuilderState | null {
  if (!schedule || schedule.trim() === "") {
    return null;
  }
  const normalized = schedule.trim();
  const expanded = MACROS[normalized] ?? normalized;

  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const [minuteField, hourField, domField, monthField, dowField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  // The builder only handles "every day of month" / "every month".
  if (domField !== "*" || monthField !== "*") {
    return null;
  }

  const minute = parseIntStrict(minuteField);
  if (minute === null || minute > 59) {
    return null;
  }

  const base = defaultScheduleBuilderState();

  // Hourly: specific minute, wildcard hour + weekday.
  if (hourField === "*" && dowField === "*") {
    return { ...base, frequency: "hourly", minute };
  }

  const hour = parseIntStrict(hourField);
  if (hour === null || hour > 23) {
    return null;
  }

  // Daily: specific minute + hour, any weekday.
  if (dowField === "*") {
    return { ...base, frequency: "daily", minute, hour };
  }

  // Weekly: specific minute + hour on specific weekdays.
  const weekdays = parseWeekdays(dowField);
  if (weekdays === null) {
    return null;
  }
  return { ...base, frequency: "weekly", minute, hour, weekdays };
}
