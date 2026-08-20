/**
 * Configuration and messaging for #1288: the declared-expectation circling
 * detector, the far-outer step ceiling, and the diff acceptance check.
 *
 * Pure, workflow-safe module (no DB, no Node built-ins) — reached from
 * `app/workflows/chat.ts`, a `"use workflow"` function, via a static import,
 * same precedent as `headless-progress-budget.ts`.
 */

/**
 * How many consecutive steps a run declared `expectFileChanges: true` may go
 * without an actual git-tree change before it is stopped as producing no
 * output.
 *
 * Raised from 20 to 40 on 2026-08-16. Measured cost of 20: three dispatched
 * slices out of roughly seven that day were stopped by it while doing
 * legitimate work — reading the files they had been instructed to match
 * conventions with, before writing anything. In each case the analysis in the
 * transcript was correct and the slice simply never reached its first edit.
 * One had already traced every consumer of the module it was sent to change.
 *
 * 40 is not a measured optimum and should not be presented as one. It is
 * double a value with three observed false stops, still far below the
 * ceiling, and callers who know their task's shape can now override it
 * per-run via `resolveStepsWithoutDiffAllowance`, which is the real fix — a
 * single global number cannot serve both a read-heavy refactor and a
 * one-line change.
 */
export const DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF = 40;

/** Same ceiling rationale as HEADLESS_RUN_MAX_STALE_STEPS_CEILING. */
export const HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING = 100;

/**
 * Reads `HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF`. Falls back to the default for
 * a missing, non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getHeadlessRunMaxStepsWithoutDiff(): number {
  const raw = process.env.HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF?.trim();
  if (!raw) {
    return DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF;
  }
  return Math.min(parsed, HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING);
}

/**
 * What a caller may declare for `expectFileChanges`.
 *
 * `true` takes the configured default. A number sets this run's own
 * allowance, because the dispatcher knows things the server cannot: a slice
 * told to match existing conventions has to read several files before it
 * writes anything, while a slice told to change one line should stop almost
 * immediately. The env var cannot express that — it is global, and those two
 * runs sit side by side.
 */
export type DeclaredFileChangeExpectation = boolean | number;

/**
 * Resolves the no-diff allowance for one run.
 *
 * Returns null when the fuse is not armed (`false`/omitted) — a read-only run
 * is unaffected, which is the #1242 behaviour that must not regress.
 *
 * A non-positive or non-finite number falls back to the default rather than
 * disabling the fuse. Letting `0` mean "never stop" would convert a cost
 * control into an unbounded run, which is exactly what it exists to prevent.
 * Fractional values floor to at least 1.
 */
export function resolveStepsWithoutDiffAllowance(
  declared: DeclaredFileChangeExpectation | undefined,
): number | null {
  if (declared === undefined || declared === false) {
    return null;
  }
  if (declared === true) {
    return getHeadlessRunMaxStepsWithoutDiff();
  }
  if (!Number.isFinite(declared) || declared <= 0) {
    return getHeadlessRunMaxStepsWithoutDiff();
  }
  return Math.min(
    Math.max(1, Math.floor(declared)),
    HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING,
  );
}

/**
 * The far outer step ceiling (#1288 design decision, option 3): a generous,
 * env-tunable backstop under EVERY run, headless or browser — not the
 * primary bound. It only ever fires when nothing more specific already
 * stopped the run (the no-progress fuse, the no-sandbox cap, the declared-
 * expectation circling check, or an explicit `maxSteps`), which is why the
 * default sits comfortably above the browser chat route's own 500-step
 * default: for a bounded run this is simply never reached.
 */
export const DEFAULT_RUN_OUTER_STEP_CEILING = 1000;

/** Generous upper clamp so a misconfigured env var cannot defeat the point
 * of a backstop by effectively disabling it. */
export const RUN_OUTER_STEP_CEILING_CEILING = 5000;

/**
 * Reads `RUN_OUTER_STEP_CEILING`. Falls back to the default for a missing,
 * non-numeric, or non-positive value; clamps to the ceiling above.
 */
export function getRunOuterStepCeiling(): number {
  const raw = process.env.RUN_OUTER_STEP_CEILING?.trim();
  if (!raw) {
    return DEFAULT_RUN_OUTER_STEP_CEILING;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RUN_OUTER_STEP_CEILING;
  }
  return Math.min(parsed, RUN_OUTER_STEP_CEILING_CEILING);
}

/**
 * The message a reading agent sees when the declared-expectation circling
 * check ends the turn — distinct wording from the generic no-progress fuse
 * message, since the cause is different (a DECLARED expectation went unmet,
 * not tool-call repetition) and a reader debugging logs should not conflate
 * the two.
 */
export function buildHeadlessNoFileChangesMessage(
  stepsWithoutChange: number,
  allowance: number,
): string {
  return [
    `Stopped: this run was declared to change files, but ${stepsWithoutChange} consecutive steps produced no workspace change (limit ${allowance}), so it is ending instead of continuing to burn steps with no output.`,
    "",
    "If the goal is still valid, send a follow-up message with a narrower next step or the missing decision.",
  ].join("\n");
}

/**
 * The message a reading agent sees when the far-outer step ceiling ends the
 * turn — named as a backstop, not a normal completion, so a reader does not
 * mistake it for the run's own budgets (the no-progress fuse, the no-sandbox
 * cap, or the declared-expectation check) having done their job.
 */
export function buildRunOuterStepCeilingMessage(ceiling: number): string {
  return [
    `Stopped: this run reached the outer step ceiling (${ceiling}) — a hard backstop, not the primary bound. None of this run's other budgets ended it first, which is unusual and worth reviewing.`,
    "",
    "If the goal is still valid, send a follow-up message with a narrower next step.",
  ].join("\n");
}

/** Explains that the run exhausted its caller-supplied step budget. */
export function buildMaxStepsMessage(): string {
  return [
    "Stopped: this run exhausted its step budget, so the work may be incomplete.",
    "",
    "Send a follow-up message to continue the work from here.",
  ].join("\n");
}

/** Explains a response that stayed truncated through every continuation. */
export function buildTruncatedMessage(): string {
  return [
    "Stopped: the model hit the provider's output-token ceiling and stayed truncated after every automatic continuation. The recorded response is INCOMPLETE.",
    "",
    "Send a follow-up message to continue the work from here.",
  ].join("\n");
}

/** Explains a provider stop whose specific cause could not be classified. */
export function buildRunEndedUnexpectedlyMessage(): string {
  return [
    "Stopped: the provider ended the run for an unusual reason, and the reason is unclassified.",
    "",
    "Retry the request. If the problem continues, send a follow-up message with the same goal.",
  ].join("\n");
}

/**
 * The message a dispatching agent sees when a headless run stopped because a
 * tool call needed approval.
 *
 * For an attended run this state is a genuine pause: the person watching
 * clicks approve and the run continues. For a headless run — one dispatched
 * over MCP with nobody attached — it is terminal, because no route, tool or
 * API resolves a pending approval; only a browser click does. Reported as a
 * pause it reads as "waiting", and a run that is actually dead sits looking
 * patient. Say plainly that it is over and what to change.
 */
export function buildHeadlessAwaitingApprovalMessage(): string {
  return [
    "Stopped: a tool call needed approval and this run has nobody to give it.",
    "",
    "No human is attached to a headless run, and a pending approval cannot be resumed by approving it later — there is no non-browser path that resolves one. This run is over, not waiting.",
    "",
    "Re-dispatch with a prompt that avoids the gated call, or make the call unnecessary. If the gated call is genuinely required, run it attended in the browser instead.",
  ].join("\n");
}

/**
 * The message a reading agent (and a human reviewer reading the transcript
 * afterward) sees when the final diff touched a file outside the caller's
 * declared `expectedFiles` list. Informational, not a mid-run stop: by the
 * time this fires the run has already finished, so it is appended to the
 * already-final assistant response rather than breaking a loop.
 */
export function buildDiffAcceptanceViolationMessage(
  offendingPaths: string[],
): string {
  return [
    `Stopped: this run's diff touched ${offendingPaths.length} file(s) outside the declared file list: ${offendingPaths.join(", ")}.`,
    "",
    "Review the diff before trusting or merging this run's output.",
  ].join("\n");
}
