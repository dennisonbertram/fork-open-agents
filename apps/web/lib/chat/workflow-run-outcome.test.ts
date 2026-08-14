import { describe, expect, test } from "bun:test";
import { deriveWorkflowRunOutcomeStatus } from "./workflow-run-outcome";

/**
 * #1241: workflowRuns.status used to collapse four distinct deliberate stops
 * (no-progress fuse, no-sandbox step cap, max steps exhausted, repeated tool
 * failure) into a single "failed" value, indistinguishable from a genuine
 * crash and from each other. This function is the single place that maps the
 * raw stop signals onto the persisted, widened status vocabulary — reusing
 * the same literal values `stopReason` already emits (#1231), not a second
 * vocabulary.
 */
describe("deriveWorkflowRunOutcomeStatus", () => {
  const base = {
    crashed: false,
    wasAborted: false,
    stoppedForRepeatedToolFailure: false,
    exhaustedMaxSteps: false,
    headlessFuseTripped: false,
    headlessNoSandboxCapped: false,
    truncationBoundExhausted: false,
    awaitingToolApproval: false,
    endedUnexpectedly: false,
  };

  test("a clean finish is completed", () => {
    expect(deriveWorkflowRunOutcomeStatus(base)).toBe("completed");
  });

  test("the no-progress fuse is distinct from a generic failure", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({ ...base, headlessFuseTripped: true }),
    ).toBe("no_progress_fuse");
  });

  test("the no-sandbox step cap is distinct from the no-progress fuse", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        headlessNoSandboxCapped: true,
      }),
    ).toBe("no_sandbox_step_cap");
  });

  test("exhausting maxSteps reports its own value", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({ ...base, exhaustedMaxSteps: true }),
    ).toBe("max_steps");
  });

  test("repeated tool failure reports its own value", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        stoppedForRepeatedToolFailure: true,
      }),
    ).toBe("repeated_tool_failure");
  });

  test("a user-initiated abort takes priority over any stop signal", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        wasAborted: true,
        headlessFuseTripped: true,
      }),
    ).toBe("aborted");
  });

  test("a crash reports failed even if a stop signal happened to be set", () => {
    // A real exception can be thrown after a stop-condition flag was already
    // flipped; the crash must still win so `failed` keeps meaning "the
    // workflow threw", not "a deliberate stop that also happened to throw".
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        crashed: true,
        headlessFuseTripped: true,
      }),
    ).toBe("failed");
  });

  test("a crash during an aborted run still reports aborted, not failed", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        crashed: true,
        wasAborted: true,
      }),
    ).toBe("aborted");
  });

  // #1247: `length` cut a step off mid-work — the model had more to say, so
  // the run continues instead of ending there. Only when the continuation
  // budget itself runs out is the run reported at all, and it must be
  // reported as truncated, not as a clean completion.
  test("exhausting the length-continuation budget reports its own value", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        truncationBoundExhausted: true,
      }),
    ).toBe("truncated");
  });

  // #1247: a run that pauses for tool approval is neither a clean finish nor
  // a truncation — it is waiting on the user for the next turn.
  test("pausing for tool approval reports its own value, distinct from completed and from truncated", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        awaitingToolApproval: true,
      }),
    ).toBe("awaiting_tool_approval");
  });

  // #1247: content-filter / error / other all share one value — none of them
  // is a guess about intent (unlike the rejected todo-based heuristic), but
  // splitting three rare provider-side exits into three separate names a
  // caller would have to special-case individually was not worth the
  // vocabulary growth. See the module doc for the full reasoning.
  test("an unhandled finish reason (content-filter / error / other) reports the shared 'ended unexpectedly' value", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        endedUnexpectedly: true,
      }),
    ).toBe("ended_unexpectedly");
  });

  test("exhausted maxSteps takes priority over a length-continuation flag left set from an earlier step", () => {
    // Mutually exclusive in practice (only one break fires per run), but the
    // precedence must still be deterministic if that ever changes.
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        exhaustedMaxSteps: true,
        truncationBoundExhausted: true,
      }),
    ).toBe("max_steps");
  });

  test("a crash reports failed even if the truncation budget was exhausted", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        crashed: true,
        truncationBoundExhausted: true,
      }),
    ).toBe("failed");
  });

  test("a user-initiated abort takes priority over an approval pause", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        wasAborted: true,
        awaitingToolApproval: true,
      }),
    ).toBe("aborted");
  });

  // Regression: if a user stops a run in the middle of a length-continuation
  // sequence (the "length" step already counted toward the budget, then the
  // abort lands before the next step starts), the run must be filed
  // "aborted" — the user's own action — not "truncated". Reverting this
  // precedence would misreport a run the user deliberately stopped as one
  // that ran out of retries on its own.
  test("a user-initiated abort takes priority over an exhausted truncation budget", () => {
    expect(
      deriveWorkflowRunOutcomeStatus({
        ...base,
        wasAborted: true,
        truncationBoundExhausted: true,
      }),
    ).toBe("aborted");
  });
});
