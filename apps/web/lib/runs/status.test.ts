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
