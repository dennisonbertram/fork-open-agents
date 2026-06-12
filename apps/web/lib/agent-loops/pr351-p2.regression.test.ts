/**
 * Regression test for PR #351 P2 fix — dispatcher-bridge layer.
 *
 * REG-P2-001: dispatchManualAgentLoopStart active_run result includes activeRunId
 *
 * This test FAILS if the LoopDispatchResult type change or activeRunId
 * inclusion in the active_run return is reverted.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Store mocks ────────────────────────────────────────────────────────────────

const ACTIVE_RUN_ID = "run_existing_paused_001";

const hasActiveRunForLoop = mock(async () => ACTIVE_RUN_ID);
const getOwnedAgentLoop = mock(async () => ({
  id: "loop-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: {
    nodes: [
      { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
      { id: "e", kind: "end", label: "E", position: { x: 1, y: 0 } },
    ],
    edges: [{ id: "e1", source: "s", target: "e", when: "always" }],
  } as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "PR-351-P2 Regression Loop",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const recordAgentLoopEvent = mock(async () => ({
  id: "ev-reg",
  loopRunId: ACTIVE_RUN_ID,
  eventName: "test",
  status: "info" as const,
  level: "info" as const,
  createdAt: new Date(),
}));
const createAgentLoopRun = mock(async () => ({
  run: { id: "new-run" },
  created: true,
}));

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoopRun,
  hasActiveRunForLoop,
  getOwnedAgentLoop,
  createAgentLoopStepRun: mock(async () => ({ id: "step-1" })),
  updateAgentLoopRunStatus: mock(async () => null),
  recordAgentLoopEvent,
}));

mock.module("workflow/api", () => ({
  start: mock(async () => ({ runId: "wf-1" })),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: {},
}));
mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => true,
  isAgentLoopRepoAllowed: () => true,
}));
mock.module("@/lib/agent-loops/validation", () => ({
  validateLoopDefinition: () => ({
    ok: true,
    definition: {
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "e", kind: "end", label: "E", position: { x: 1, y: 0 } },
      ],
      edges: [{ id: "e1", source: "s", target: "e", when: "always" }],
    },
  }),
}));

const bridgeModulePromise = import("./dispatcher-bridge");

describe("REGRESSION-P2-001: dispatchManualAgentLoopStart active_run result shape", () => {
  beforeEach(() => {
    hasActiveRunForLoop.mockClear();
    hasActiveRunForLoop.mockImplementation(async () => ACTIVE_RUN_ID);
    createAgentLoopRun.mockClear();
    recordAgentLoopEvent.mockClear();
  });

  test("REG-P2-001a: active_run result includes activeRunId from hasActiveRunForLoop", async () => {
    // If the LoopDispatchResult type change is reverted OR the active_run
    // return site stops including activeRunId, this test fails.
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-reg-p2-001a",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    // REG-P2-001a: the run ID returned by hasActiveRunForLoop must be
    // included in the skip result so callers can surface it to users.
    expect((result as { activeRunId?: string }).activeRunId).toBe(
      ACTIVE_RUN_ID,
    );
    // createAgentLoopRun must NOT have been called — skipped before create
    expect(createAgentLoopRun).not.toHaveBeenCalled();
  });

  test("REG-P2-001b: active_run activeRunId matches the actual conflicting run", async () => {
    // Verify the specific run ID is carried through, not just "any truthy value".
    const specificRunId = "run_paused_specific_789";
    hasActiveRunForLoop.mockImplementation(async () => specificRunId);

    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;
    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-reg-p2-001b",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    // REG-P2-001b: activeRunId must match the specific conflicting run ID
    expect((result as { activeRunId?: string }).activeRunId).toBe(
      specificRunId,
    );
  });
});
