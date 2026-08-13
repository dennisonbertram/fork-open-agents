/**
 * Timestamp coercion for values that cross the MCP tool boundary.
 *
 * Not every value typed `Date` in a db helper's return type is one at runtime.
 * `getSessionsWithUnreadByUserId` declares `lastActivityAt: Date` but computes
 * it as a raw `sql<Date>` expression, and postgres-js hands those back as
 * strings — calling `.toISOString()` directly turned every real list_sessions
 * call into internal_error while mocked tests stayed green. Coerce defensively
 * at every timestamp instead of trusting the declared type.
 */
export type CoercibleTimestamp = Date | string | number | null | undefined;

export function toEpochMs(value: CoercibleTimestamp): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value;
  }
  // The columns behind these values are `timestamp`, not `timestamptz`, so a
  // raw driver string carries no offset ("2026-01-01 00:05:00") and `new Date`
  // would resolve it in the server's local zone — shifting it by the UTC
  // offset. Drizzle's own PgTimestamp mapper appends "+0000" for
  // non-timezone columns; do the same so both paths agree on the instant.
  const normalized =
    // Postgres writes the offset as "+00", "+0000", or "+00:00" depending on
    // the driver, so all three must count as already-zoned.
    /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(value)
      ? value
      : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function toIsoString(value: CoercibleTimestamp): string | null {
  const epochMs = toEpochMs(value);
  return epochMs === null ? null : new Date(epochMs).toISOString();
}
