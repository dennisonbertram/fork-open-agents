import { describe, expect, test } from "bun:test";
import { normalizeRunStatus } from "./status";

describe("normalized run status", () => {
  test.each([
    {
      source: "chat_workflow" as const,
      nativeStatus: "completed",
      expected: {
        state: "finished",
        outcome: "succeeded",
        health: "ok",
        attentionReasons: [],
      },
    },
    {
      source: "chat_workflow" as const,
      nativeStatus: "unexpected-provider-state",
      expected: {
        state: "unknown",
        outcome: "unknown",
        health: "unknown",
        attentionReasons: ["unknown_status"],
      },
    },
    {
      source: "background_agent" as const,
      nativeStatus: "skipped",
      expected: {
        state: "finished",
        outcome: "skipped",
        health: "ok",
        attentionReasons: [],
      },
    },
    {
      source: "agent_loop" as const,
      nativeStatus: "approval_pending",
      expected: {
        state: "waiting",
        outcome: null,
        health: "warning",
        attentionReasons: ["waiting_on_user"],
      },
    },
    {
      source: "agent_loop" as const,
      nativeStatus: "stalled",
      expected: {
        state: "waiting",
        outcome: null,
        health: "needs_attention",
        attentionReasons: ["stalled"],
      },
    },
  ])(
    "$source preserves $nativeStatus honestly",
    ({ source, nativeStatus, expected }) => {
      expect(normalizeRunStatus({ source, nativeStatus }) as unknown).toEqual(
        expected,
      );
    },
  );

  test("keeps active state separate from stale health", () => {
    expect(
      normalizeRunStatus({
        source: "background_agent",
        nativeStatus: "running",
        isStale: true,
      }),
    ).toEqual({
      state: "running",
      outcome: null,
      health: "needs_attention",
      attentionReasons: ["stale"],
    });
  });

  // #1241: workflowRuns.status widened to four new deliberate-stop values
  // (no_progress_fuse, no_sandbox_step_cap, max_steps,
  // repeated_tool_failure). This reader used to see only "failed" for all of
  // them; it must keep treating them as failed/needs-attention rather than
  // falling into the catch-all "unknown" branch, or every account-coordinator
  // consumer of chat_workflow runs silently loses failure visibility the
  // moment the writer starts persisting the more specific value.
  test.each([
    "no_progress_fuse",
    "no_sandbox_step_cap",
    "max_steps",
    "repeated_tool_failure",
    // #1247: two more deliberate-stop values, widening workflowRuns.status a
    // second time so soon after #1241 — the exact hazard #1241 called out.
    // Without this branch a truncated or unexpectedly-ended run would fall
    // through to the catch-all "unknown" below instead of staying visible
    // as needing attention.
    "truncated",
    "ended_unexpectedly",
    // #1288: a third widening — the declared-expectation circling stop, the
    // outer step ceiling, and the diff-acceptance violation. Same hazard,
    // same fix: without this branch each one would silently degrade to
    // "unknown" the moment the writer starts persisting it.
    "no_file_changes",
    "step_ceiling",
    "diff_violation",
  ])(
    "chat_workflow keeps treating %s as a failure needing attention",
    (nativeStatus) => {
      expect(
        normalizeRunStatus({ source: "chat_workflow", nativeStatus }),
      ).toEqual({
        state: "finished",
        outcome: "failed",
        health: "needs_attention",
        attentionReasons: ["failed"],
      });
    },
  );

  // #1247: pausing for tool approval is not a failure — it is the run
  // waiting on the user for the next turn, the same shape as
  // "approval_pending" already gets for other run sources. Falling through
  // to "unknown" here would be the same silent-degradation bug #1241 fixed
  // for the other four deliberate-stop values.
  test("chat_workflow awaiting_tool_approval reports as waiting on the user", () => {
    expect(
      normalizeRunStatus({
        source: "chat_workflow",
        nativeStatus: "awaiting_tool_approval",
      }),
    ).toEqual({
      state: "waiting",
      outcome: null,
      health: "warning",
      attentionReasons: ["waiting_on_user"],
    });
  });

  test("keeps a completed loop successful while warning about failed steps", () => {
    expect(
      normalizeRunStatus({
        source: "agent_loop",
        nativeStatus: "completed",
        failedStepCount: 2,
      }),
    ).toEqual({
      state: "finished",
      outcome: "succeeded",
      health: "warning",
      attentionReasons: ["failed_steps"],
    });
  });
});
