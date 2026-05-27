function parseCronNumber(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function matchesCronField(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === "*") {
    return true;
  }

  if (field.includes(",")) {
    return field
      .split(",")
      .some((part) => matchesCronField(part.trim(), value, min, max));
  }

  if (field.startsWith("*/")) {
    const step = parseCronNumber(field.slice(2), 1, max);
    return step !== null && (value - min) % step === 0;
  }

  if (field.includes("-")) {
    const [startRaw, endRaw] = field.split("-");
    const start = startRaw ? parseCronNumber(startRaw, min, max) : null;
    const end = endRaw ? parseCronNumber(endRaw, min, max) : null;
    return start !== null && end !== null && value >= start && value <= end;
  }

  const exact = parseCronNumber(field, min, max);
  return exact === value;
}

export function scheduleMatchesNow(
  schedule: string | null | undefined,
  now: Date,
): boolean {
  const normalized = schedule?.trim();
  if (!normalized) {
    return true;
  }

  if (normalized === "@hourly") {
    return now.getUTCMinutes() === 0;
  }
  if (normalized === "@daily") {
    return now.getUTCHours() === 0 && now.getUTCMinutes() === 0;
  }
  if (normalized === "@weekly") {
    return (
      now.getUTCDay() === 0 &&
      now.getUTCHours() === 0 &&
      now.getUTCMinutes() === 0
    );
  }

  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    matchesCronField(minute ?? "", now.getUTCMinutes(), 0, 59) &&
    matchesCronField(hour ?? "", now.getUTCHours(), 0, 23) &&
    matchesCronField(dayOfMonth ?? "", now.getUTCDate(), 1, 31) &&
    matchesCronField(month ?? "", now.getUTCMonth() + 1, 1, 12) &&
    matchesCronField(dayOfWeek ?? "", now.getUTCDay(), 0, 6)
  );
}
