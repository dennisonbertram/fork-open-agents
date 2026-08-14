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
 * #1242 follow-up: cycle-detection knobs for
 * `app/workflows/headless-progress-detector.ts`, which catches an agent
 * alternating between 2..N distinct tool calls with a frozen git tree (the
 * adjacent-only comparison above only ever caught a STRICT repeat). Mirrors
 * `detectRepetition`'s own defaults (`maxCyclePeriod: 3`, `cycleRepeats: 2`
 * in `lib/background-agents/repetition-detector.ts`) rather than picking new
 * numbers — those defaults already cover both required shapes (an A/B loop
 * and a 3-call A/B/C loop) without searching arbitrarily long patterns that
 * are unlikely to be a real wedge.
 */
export const DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD = 3;

/** Same ceiling rationale as HEADLESS_RUN_MAX_STALE_STEPS_CEILING. A period
 * this long is barely distinguishable from "always varying" — bounding it
 * also bounds the per-step cost of the cycle search. */
export const HEADLESS_RUN_MAX_CYCLE_PERIOD_CEILING = 10;

/**
 * Reads `HEADLESS_RUN_MAX_CYCLE_PERIOD`. Falls back to the default for a
 * missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getHeadlessRunMaxCyclePeriod(): number {
  const raw = process.env.HEADLESS_RUN_MAX_CYCLE_PERIOD?.trim();
  if (!raw) {
    return DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD;
  }
  return Math.min(parsed, HEADLESS_RUN_MAX_CYCLE_PERIOD_CEILING);
}

export const DEFAULT_HEADLESS_RUN_CYCLE_REPEATS = 2;

/** Same ceiling rationale as HEADLESS_RUN_MAX_STALE_STEPS_CEILING. */
export const HEADLESS_RUN_CYCLE_REPEATS_CEILING = 5;

/**
 * Reads `HEADLESS_RUN_CYCLE_REPEATS`. Falls back to the default for a
 * missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getHeadlessRunCycleRepeats(): number {
  const raw = process.env.HEADLESS_RUN_CYCLE_REPEATS?.trim();
  if (!raw) {
    return DEFAULT_HEADLESS_RUN_CYCLE_REPEATS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_RUN_CYCLE_REPEATS;
  }
  return Math.min(parsed, HEADLESS_RUN_CYCLE_REPEATS_CEILING);
}

/**
 * The message a reading agent (there is no human watching a headless run)
 * sees when the no-progress fuse ends the turn. Must be legible on its own —
 * what was attempted is already in the transcript above this message; this
 * states why the run stopped and what to do next.
 *
 * #1242 follow-up: names the SPECIFIC pattern the detector found, not a
 * single generic sentence — a reading agent has to act on which one fired:
 *  - "stalled_tree": the original #1231 shape, no workspace change and no
 *    tool-call activity at all.
 *  - "repeat": the identical tool call, called over and over.
 *  - "cycle": a short repeating block of DISTINCT tool calls (e.g. A, B,
 *    A, B) — the shape this follow-up adds detection for.
 */
export function buildHeadlessProgressFuseMessage(input: {
  reason: "stalled_tree" | "repeat" | "cycle";
  repeatCount: number;
  cycleLength: number | null;
  maxStaleSteps: number;
}): string {
  const { reason, repeatCount, cycleLength, maxStaleSteps } = input;
  const lead =
    reason === "cycle"
      ? `Stopped: a repeating ${cycleLength}-call pattern of tool calls with no workspace change was detected, so this headless run is ending instead of continuing to burn steps with no progress.`
      : reason === "repeat"
        ? `Stopped: the same tool call was repeated ${repeatCount} times in a row with no workspace change, so this headless run is ending instead of continuing to burn steps with no progress.`
        : `Stopped: no workspace changes or new tool-call activity were detected for ${repeatCount} consecutive steps (limit ${maxStaleSteps}), so this headless run is ending instead of continuing to burn steps with no progress.`;
  return [
    lead,
    "",
    "If the goal is still valid, send a follow-up message with a narrower next step or the missing decision.",
  ].join("\n");
}

/**
 * Fallback bound for a headless run with no sandbox to probe (a no-repo
 * session — createSessionCore sets `sandboxState: null` when there is no
 * repo, so `open_agents_send_message` can start a headless run against one
 * exactly like any other owned session). The no-progress fuse above cannot
 * see progress there — every probe would be null, which the budget treats as
 * "unknown, not stale" forever — so a plain step count is the only signal
 * available. Independently tunable from HEADLESS_RUN_MAX_STALE_STEPS: the two
 * bound different failure modes (stalled-with-a-workspace vs.
 * cannot-observe-a-workspace) and may need different values.
 */
export const DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP = 50;

/** Same ceiling rationale as HEADLESS_RUN_MAX_STALE_STEPS_CEILING. */
export const HEADLESS_RUN_NO_SANDBOX_STEP_CAP_CEILING = 500;

/**
 * Reads `HEADLESS_RUN_NO_SANDBOX_STEP_CAP`. Falls back to the default for a
 * missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getHeadlessRunNoSandboxStepCap(): number {
  const raw = process.env.HEADLESS_RUN_NO_SANDBOX_STEP_CAP?.trim();
  if (!raw) {
    return DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP;
  }
  return Math.min(parsed, HEADLESS_RUN_NO_SANDBOX_STEP_CAP_CEILING);
}

/**
 * The message a reading agent sees when the no-sandbox fallback cap ends the
 * turn — distinct from `buildHeadlessProgressFuseMessage` because the cause
 * is different (no workspace to observe, not a stalled one) and a reader
 * debugging logs should not conflate the two.
 */
export function buildHeadlessNoSandboxCapMessage(cap: number): string {
  return [
    `Stopped: this session has no sandbox, so progress cannot be observed, and this headless run reached the fixed step cap for that case (${cap}).`,
    "",
    "If the goal needs a workspace (reading or changing files), retry against a repo-backed session. Otherwise send a follow-up message with a narrower next step.",
  ].join("\n");
}
