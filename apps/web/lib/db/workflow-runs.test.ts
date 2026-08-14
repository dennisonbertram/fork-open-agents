import { describe, expect, test } from "bun:test";
import { deriveWorkflowRunOutcomeStatus } from "./workflow-runs";

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
});
