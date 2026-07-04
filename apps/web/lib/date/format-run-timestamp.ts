/**
 * Shared timestamp formatter for the agents surfaces (agent list, agent
 * detail, schedule card).
 *
 * Renders in explicit UTC with the zone label baked into the string (e.g.
 * "Jul 3, 2026 at 9:20 PM UTC") rather than the browser/server's local zone.
 *
 * This is intentional: schedule expressions (cron) are evaluated in UTC (see
 * lib/background-agents/schedule.ts / schedule-presets.ts, which use
 * getUTCMinutes/getUTCHours/getUTCDay etc.), so last-run/next-run times must
 * be labeled and rendered in UTC to avoid misleading the user about when a
 * run actually fired or will fire. Two of the three agents surfaces
 * (agents/page.tsx, agents/[agentId]/page.tsx) are async server components
 * that cannot know the browser's timezone, while the schedule card renders
 * client-side — rendering all three in the SAME explicit zone (rather than
 * "browser-local everywhere", which the server components cannot do) is what
 * keeps the run list and run detail pages showing the same wall-clock time
 * for the same instant. Locale is pinned to "en-US" so server-rendered and
 * client-rendered output match exactly (no hydration mismatch) and so tests
 * are deterministic across environments.
 *
 * Do not add a fourth inline Intl.DateTimeFormat call site for these
 * surfaces — use this utility instead.
 */

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

// Some ICU builds emit a narrow no-break space (U+202F) before AM/PM instead
// of a regular space; normalize so output is stable across runtimes.
const NARROW_NO_BREAK_SPACE = " ";

export function formatRunTimestamp(
  value: Date | string | null | undefined,
  options?: { fallback?: string },
): string {
  const fallback = options?.fallback ?? "-";
  if (value === null || value === undefined) {
    return fallback;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const formatted = FORMATTER.format(date).replaceAll(
    NARROW_NO_BREAK_SPACE,
    " ",
  );
  return `${formatted} UTC`;
}
