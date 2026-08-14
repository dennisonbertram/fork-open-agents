/**
 * Configuration for continuing a run past a step truncated by the
 * provider's per-response output-token ceiling (#1247).
 *
 * Pure, workflow-safe module (no DB, no Node built-ins) — reached from
 * `app/workflows/chat.ts`, a `"use workflow"` function, via a static import.
 * `process.env` reads are fine here (a global, not an import); mirrors
 * `lib/chat/headless-progress-budget.ts`'s own precedent for a
 * process.env-backed config constant reaching a workflow function this way.
 */

/**
 * A step whose `finishReason` is `"length"` was cut off mid-work, not
 * finished — the model had more to say. Continuing costs one more provider
 * round-trip; a handful of them is cheap insurance that lets a response
 * which merely needed a bit more room (a large file write, a long
 * explanation) finish normally on the next step. Past that, a response that
 * is truncated on every single step is not going to fit no matter how many
 * more steps it gets, and burning further budget on it is less honest than
 * reporting the truncation and stopping.
 */
export const DEFAULT_MAX_LENGTH_CONTINUATIONS = 3;

/** Same ceiling rationale as HEADLESS_RUN_MAX_STALE_STEPS_CEILING: a generous
 * upper bound so a misconfigured env var cannot turn "continue past a
 * truncation" into an unbounded, runaway-cost loop. */
export const MAX_LENGTH_CONTINUATIONS_CEILING = 10;

/**
 * Reads `CHAT_MAX_LENGTH_CONTINUATIONS`. Falls back to the default for a
 * missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getMaxLengthContinuations(): number {
  const raw = process.env.CHAT_MAX_LENGTH_CONTINUATIONS?.trim();
  if (!raw) {
    return DEFAULT_MAX_LENGTH_CONTINUATIONS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_LENGTH_CONTINUATIONS;
  }
  return Math.min(parsed, MAX_LENGTH_CONTINUATIONS_CEILING);
}
