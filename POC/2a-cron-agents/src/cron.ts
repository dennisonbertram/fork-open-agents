/**
 * Cron evaluation backed by the real `cron-parser` library.
 *
 * The repo today ships a hand-rolled `scheduleMatchesNow` in
 * `apps/web/lib/background-agents/schedule.ts` that only answers "does this
 * 5-field expression match the current minute?". That works for a fixed
 * every-5-minutes tick but cannot:
 *   - compute the NEXT fire time (needed to persist next_run_at and survive
 *     a missed/teardown tick), or
 *   - decide due-ness from a stored next_run_at independent of tick alignment.
 *
 * This POC uses cron-parser to do both, which is the correct foundation for
 * standing agents whose cadence (e.g. `0 9 * * *`) is finer-grained than the
 * platform cron tick.
 */
import parser from "cron-parser";

/** Cron-parser interprets all expressions in UTC for determinism. */
const PARSER_OPTS = { tz: "UTC" as const };

export function isValidCron(expression: string): boolean {
  try {
    parser.parseExpression(expression, PARSER_OPTS);
    return true;
  } catch {
    return false;
  }
}

/**
 * The next fire time strictly after `from` (default: now).
 */
export function nextRunAfter(expression: string, from: Date = new Date()): Date {
  const it = parser.parseExpression(expression, {
    ...PARSER_OPTS,
    currentDate: from,
  });
  return it.next().toDate();
}

/**
 * The previous fire time at or before `at` (the scheduled minute that `at`
 * belongs to). Used as the idempotency tick key so two cron invocations in
 * the same scheduled window dispatch the same logical run exactly once.
 */
export function scheduledTickFor(expression: string, at: Date): Date {
  const it = parser.parseExpression(expression, {
    ...PARSER_OPTS,
    // prev() is exclusive of currentDate, so nudge to end of the current
    // minute to capture a fire time that lands exactly on `at`.
    currentDate: new Date(at.getTime() + 59_999),
  });
  return it.prev().toDate();
}

/**
 * A job is due when:
 *   - it has never run and its cron has a fire time at/just-before now, OR
 *   - its persisted next_run_at is <= now.
 *
 * We compute due-ness from the schedule's tick boundary so that the platform
 * cron tick (which may be coarser than the job cadence on Hobby plans, or
 * jittered) does not require minute-exact alignment.
 */
export function isDue(
  expression: string,
  now: Date,
  nextRunAt: Date | null,
  toleranceMs = 60_000,
): boolean {
  if (nextRunAt) {
    return nextRunAt.getTime() <= now.getTime();
  }
  // No stored schedule yet: due if the most recent scheduled tick is within
  // one window of now.
  const tick = scheduledTickFor(expression, now);
  return now.getTime() - tick.getTime() < toleranceMs;
}
