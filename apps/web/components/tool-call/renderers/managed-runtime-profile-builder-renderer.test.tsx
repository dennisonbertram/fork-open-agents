import { describe, expect, test } from "bun:test";
import {
  buildManagedRuntimeProfileRevisionInstructions,
  formatManagedRuntimeTestError,
  getApproveButtonLabel,
  getForceApprovedLabel,
  getProfileApprovalWarning,
  getRevisionPlaceholder,
} from "./managed-runtime-profile-builder-renderer";

describe("managed runtime profile builder revision instructions", () => {
  test("appends failed verification evidence to revision requests", () => {
    const instructions = buildManagedRuntimeProfileRevisionInstructions({
      userInstructions: "Please fix the Bun install path.",
      draft: {
        id: "draft-1",
        status: "needs_changes",
        testFailureMessage: "Verify Bun failed.",
        testedAt: "2026-05-24T00:00:00.000Z",
        testResults: [
          {
            commandId: "verify-bun",
            label: "Verify Bun",
            status: "failed",
            required: true,
            exitCode: 127,
            summary: "bun: command not found",
            startedAt: "2026-05-24T00:00:00.000Z",
            finishedAt: "2026-05-24T00:00:01.000Z",
          },
          {
            commandId: "observe-node",
            label: "Observe Node",
            status: "passed",
            required: false,
            exitCode: 0,
            summary: "v24.0.0",
            startedAt: "2026-05-24T00:00:01.000Z",
            finishedAt: "2026-05-24T00:00:02.000Z",
          },
        ],
      },
    });

    expect(instructions).toContain("Please fix the Bun install path.");
    expect(instructions).toContain("Latest profile test evidence");
    expect(instructions).toContain("Overall failure: Verify Bun failed.");
    expect(instructions).toContain(
      "- Verify Bun (required) failed, exit 127: bun: command not found",
    );
    expect(instructions).not.toContain("Observe Node");
  });

  test("falls back to repo-requirements revision when no evidence exists", () => {
    const instructions = buildManagedRuntimeProfileRevisionInstructions({
      userInstructions: "",
      draft: null,
    });

    expect(instructions).toBe(
      "Revise the managed runtime profile based on the repo requirements.",
    );
  });

  test("warns before approving untested or failing profile drafts", () => {
    expect(
      getProfileApprovalWarning({
        id: "draft-1",
        status: "draft_ready",
        testedAt: null,
      }),
    ).toBe(
      "This profile has not been tested against the active workspace yet.",
    );
    expect(
      getProfileApprovalWarning({
        id: "draft-1",
        status: "needs_changes",
        testedAt: "2026-05-24T00:00:00.000Z",
      }),
    ).toContain("latest profile test failed");
    expect(
      getProfileApprovalWarning({
        id: "draft-1",
        status: "tested",
        testedAt: "2026-05-24T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  test("labels approval as an override when the draft has warning evidence", () => {
    expect(
      getApproveButtonLabel({
        id: "draft-1",
        status: "draft_ready",
        testedAt: null,
      }),
    ).toBe("Approve anyway");
    expect(
      getApproveButtonLabel({
        id: "draft-1",
        status: "tested",
        testedAt: "2026-05-24T00:00:00.000Z",
      }),
    ).toBe("Approve draft");
  });

  test("uses question-aware revision placeholder copy", () => {
    expect(getRevisionPlaceholder([])).toBe("Optional revision notes");
    expect(
      getRevisionPlaceholder(["Which package manager should be used?"]),
    ).toBe("Answer the questions or describe what the agent should change");
  });

  // RED: today there is no evidenced label for a draft that was approved
  // over a failed/absent test (force_approved from MR-1's column).
  test("labels a draft as approved without passing a test when force-approved", () => {
    expect(
      getForceApprovedLabel({
        id: "draft-1",
        status: "approved",
        testedAt: null,
        forceApproved: true,
      }),
    ).toBe("Approved without passing test");
    expect(
      getForceApprovedLabel({
        id: "draft-1",
        status: "approved",
        testedAt: "2026-05-24T00:00:00.000Z",
        forceApproved: false,
      }),
    ).toBeNull();
  });

  // RED: today the test-route error is a generic string; this pins the
  // structured-error rendering contract (failed command + first actionable
  // line + next step).
  test("formats structured test errors with the failed command and next step", () => {
    const formatted = formatManagedRuntimeTestError({
      errorKind: "setup_command_failed",
      failureMessage: "Install Bun failed.",
      failedCommandLabel: "Install Bun",
      nextAction:
        "Fix the failing setup command in the profile editor, then run setup again.",
    });

    expect(formatted).toContain("Install Bun");
    expect(formatted).toContain("Install Bun failed.");
    expect(formatted).toContain(
      "Fix the failing setup command in the profile editor, then run setup again.",
    );
  });

  test("returns null when there is no structured test error", () => {
    expect(formatManagedRuntimeTestError(undefined)).toBeNull();
  });
});
