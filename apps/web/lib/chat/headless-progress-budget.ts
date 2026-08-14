/**
 * Configuration and messaging for the headless-run no-progress fuse (#1231).
 *
 * Pure, workflow-safe module (no DB, no Node built-ins) — reached from
 * `app/workflows/chat.ts`, a `"use workflow"` function, via a static import.
 * `process.env` reads are fine here (a global, not an import); the
 * `SANDBOX_LIFECYCLE_MIN_SLEEP_MS` import in `app/workflows/sandbox-lifecycle.ts`
 * is the existing precedent for a process.env-backed config constant reaching
 * a workflow function this way.
 */

/**
 * Mirrors `DEFAULT_BACKGROUND_AGENT_MAX_STALE_TURNS` (background-agents/config.ts):
 * the same cadence (one observation per model step, see lib/progress-budget.ts's
 * module doc) has been running in production for background agents, so 20 is
 * a validated starting point for headless chat runs too — kept as an
 * independently tunable env var rather than sharing
 * BACKGROUND_AGENT_MAX_STALE_TURNS, since the two run types may need
 * different values later.
 */
export const DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS = 20;

/** Same ceiling rationale as BACKGROUND_AGENT_MAX_TURNS_CEILING: a generous
 * upper bound so a misconfigured env var cannot re-create the runaway-cost
 * risk the fuse exists to prevent. */
export const HEADLESS_RUN_MAX_STALE_STEPS_CEILING = 200;

/**
 * Reads `HEADLESS_RUN_MAX_STALE_STEPS`. Falls back to the default for a
 * missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getHeadlessRunMaxStaleSteps(): number {
  const raw = process.env.HEADLESS_RUN_MAX_STALE_STEPS?.trim();
  if (!raw) {
    return DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS;
  }
  return Math.min(parsed, HEADLESS_RUN_MAX_STALE_STEPS_CEILING);
}

/**
 * The message a reading agent (there is no human watching a headless run)
 * sees when the no-progress fuse ends the turn. Must be legible on its own —
 * what was attempted is already in the transcript above this message; this
 * states why the run stopped and what to do next.
 */
export function buildHeadlessProgressFuseMessage(
  staleSteps: number,
  maxStaleSteps: number,
): string {
  return [
    `Stopped: no workspace changes were detected for ${staleSteps} consecutive steps (limit ${maxStaleSteps}), so this headless run is ending instead of continuing to burn steps with no progress.`,
    "",
    "If the goal is still valid, send a follow-up message with a narrower next step or the missing decision.",
  ].join("\n");
}
