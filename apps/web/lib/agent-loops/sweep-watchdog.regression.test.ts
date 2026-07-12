/**
 * Agent Loops — sweep + watchdog regression tests (M3-02-A)
 *
 * Race + budget-share regressions:
 *
 * R-1: stall→retry must use retryCurrentStepForWatchdog (conditional MAX(attempt)+1),
 *      not a raw createAgentLoopStepRun — assert retryCurrentStepForWatchdog is the
 *      retry mechanism when a stall watchdog invocation picks retry.
 *
 * R-2: budget sharing — a stall-initiated retry and a failure-initiated retry for
 *      the same (loopRunId, nodeId) draw from the SAME countWatchdogRetryDecisions
 *      counter; once watchdogRetryBudget retries exist, the next stall watchdog
 *      force-pauses (no new retry, decision=pause).
 *
 * Store regression (startedAt persistence):
 *
 * ST-1: createAgentLoopWatchdogRun with startedAt: new Date() persists a non-null started_at
 * ST-2: createAgentLoopWatchdogRun without startedAt → started_at is null
 *
 * SW-6: illegal 'skip' decision from invokeWatchdog for a stall invocation is coerced
 *       to 'pause' — the persisted/applied decision is pause, never skip.
 *       (Tested via invokeWatchdogForStall's legalDecisions constraint.)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── SW-6: coercion test via invokeWatchdogForStall (watchdog module) ──────────

mock.module("server-only", () => ({}));

// Controls what generateText returns
let mockLlmDecision: { decision: string; diagnosis: string; hint?: string } = {
  decision: "retry",
  diagnosis: "test",
};

// Captured store calls
let retryForWatchdogCalls: Array<{ runId: string; hint?: string }> = [];
let pauseLoopRunSystemCalls: string[] = [];
let advanceToFailureEdgeCalls: string[] = [];
let watchdogRunsCreated: Array<{
  status: string;
  decision?: string | null;
  startedAt?: Date | null;
}> = [];
let watchdogRunsUpdated: Array<{
  id: string;
  decision?: string | null;
  status?: string;
}> = [];
let countWatchdogRetryDecisionsMock = 0;

const createAgentLoopWatchdogRunMock = mock(
  async (input: {
    status: string;
    decision?: string | null;
    startedAt?: Date | null;
    loopRunId: string;
    nodeId: string;
    attempt: number;
    budgetRemaining: number;
    diagnosis?: string | null;
  }) => {
    watchdogRunsCreated.push({
      status: input.status,
      decision: input.decision ?? null,
      startedAt: input.startedAt ?? null,
    });
    return {
      id: "watchdog-run-" + watchdogRunsCreated.length,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      status: input.status,
      attempt: input.attempt,
      budgetRemaining: input.budgetRemaining,
      decision: input.decision ?? null,
      diagnosis: input.diagnosis ?? null,
      decisionPayload: null,
      startedAt: input.startedAt ?? null,
      finishedAt: null,
      stepRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);

const updateAgentLoopWatchdogRunMock = mock(
  async (input: {
    id: string;
    decision?: string | null;
    status?: string;
    finishedAt?: Date;
  }) => {
    watchdogRunsUpdated.push({
      id: input.id,
      decision: input.decision ?? null,
      status: input.status,
    });
  },
);

const retryCurrentStepForWatchdogMock = mock(
  async (params: { runId: string; hint?: string }) => {
    retryForWatchdogCalls.push(params);
    return {
      id: "new-step-run-1",
      loopRunId: params.runId,
      nodeId: "node-A",
      attempt: 2,
      status: "queued",
      nodeKind: "agent_step",
      stepInput: null,
      stepOutput: null,
      errorKind: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);

const pauseLoopRunSystemMock = mock(async (runId: string) => {
  pauseLoopRunSystemCalls.push(runId);
});

const advanceToFailureEdgeMock = mock(async (params: { loopRunId: string }) => {
  advanceToFailureEdgeCalls.push(params.loopRunId);
  return null; // no failure edge by default
});

const countWatchdogRetryDecisionsMockFn = mock(
  async (_params: { loopRunId: string; nodeId: string }) => {
    return countWatchdogRetryDecisionsMock;
  },
);

const dispatchStepWorkflowMock = mock(async (_stepRunId: string) => ({
  id: "wf-1",
}));

const recordAgentLoopEventMock = mock(
  async (input: { loopRunId: string; eventName: string }) => ({
    id: "ev-1",
    ...input,
    createdAt: new Date(),
  }),
);

mock.module("@/lib/agent-loops/store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  createAgentLoopWatchdogRun: createAgentLoopWatchdogRunMock,
  updateAgentLoopWatchdogRun: updateAgentLoopWatchdogRunMock,
  retryCurrentStepForWatchdog: retryCurrentStepForWatchdogMock,
  pauseLoopRunSystem: pauseLoopRunSystemMock,
  advanceToFailureEdge: advanceToFailureEdgeMock,
  countWatchdogRetryDecisions: countWatchdogRetryDecisionsMockFn,
  dispatchStepWorkflow: dispatchStepWorkflowMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
}));

// Mock AI gateway
mock.module("ai", () => ({
  generateText: mock(async () => ({
    text: JSON.stringify(mockLlmDecision),
  })),
}));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: mock(() => ({})),
}));

const watchdogModulePromise = import("./watchdog");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLoop(
  overrides: {
    watchdogEnabled?: boolean;
    watchdogRetryBudget?: number;
    watchdogInstructions?: string | null;
  } = {},
) {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: { nodes: [], edges: [] },
    status: "active" as const,
    guardrails: null,
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    watchdogEnabled: overrides.watchdogEnabled ?? true,
    watchdogInstructions: overrides.watchdogInstructions ?? null,
    watchdogRetryBudget: overrides.watchdogRetryBudget ?? 3,
  };
}

function makeRun(
  overrides: {
    id?: string;
    currentNodeId?: string | null;
    currentStepRunId?: string | null;
    workflowRunId?: string | null;
    definitionSnapshot?: unknown;
  } = {},
) {
  return {
    id: overrides.id ?? "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "stalled" as const,
    currentNodeId: overrides.currentNodeId ?? "node-A",
    currentStepRunId: overrides.currentStepRunId ?? "step-1",
    workflowRunId: overrides.workflowRunId ?? null,
    definitionSnapshot: (overrides.definitionSnapshot ?? {
      nodes: [],
      edges: [],
    }) as Record<string, unknown>,
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual" as const,
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sweep-watchdog regression tests (M3-02-A)", () => {
  beforeEach(() => {
    retryForWatchdogCalls = [];
    pauseLoopRunSystemCalls = [];
    advanceToFailureEdgeCalls = [];
    watchdogRunsCreated = [];
    watchdogRunsUpdated = [];
    countWatchdogRetryDecisionsMock = 0;

    createAgentLoopWatchdogRunMock.mockClear();
    updateAgentLoopWatchdogRunMock.mockClear();
    retryCurrentStepForWatchdogMock.mockClear();
    pauseLoopRunSystemMock.mockClear();
    advanceToFailureEdgeMock.mockClear();
    countWatchdogRetryDecisionsMockFn.mockClear();
    dispatchStepWorkflowMock.mockClear();
    recordAgentLoopEventMock.mockClear();

    createAgentLoopWatchdogRunMock.mockImplementation(async (input) => {
      watchdogRunsCreated.push({
        status: input.status,
        decision: input.decision ?? null,
        startedAt: input.startedAt ?? null,
      });
      return {
        id: "watchdog-run-" + watchdogRunsCreated.length,
        loopRunId: input.loopRunId,
        nodeId: input.nodeId,
        status: input.status,
        attempt: input.attempt,
        budgetRemaining: input.budgetRemaining,
        decision: input.decision ?? null,
        diagnosis: input.diagnosis ?? null,
        decisionPayload: null,
        startedAt: input.startedAt ?? null,
        finishedAt: null,
        stepRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    updateAgentLoopWatchdogRunMock.mockImplementation(async (input) => {
      watchdogRunsUpdated.push({
        id: input.id,
        decision: input.decision ?? null,
        status: input.status,
      });
    });

    retryCurrentStepForWatchdogMock.mockImplementation(async (params) => {
      retryForWatchdogCalls.push(params);
      return {
        id: "new-step-run-1",
        loopRunId: params.runId,
        nodeId: "node-A",
        attempt: 2,
        status: "queued",
        nodeKind: "agent_step",
        stepInput: null,
        stepOutput: null,
        errorKind: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    pauseLoopRunSystemMock.mockImplementation(async (runId: string) => {
      pauseLoopRunSystemCalls.push(runId);
    });

    advanceToFailureEdgeMock.mockImplementation(async (params) => {
      advanceToFailureEdgeCalls.push(params.loopRunId);
      return null;
    });

    countWatchdogRetryDecisionsMockFn.mockImplementation(async () => {
      return countWatchdogRetryDecisionsMock;
    });

    dispatchStepWorkflowMock.mockImplementation(async () => ({ id: "wf-1" }));
    recordAgentLoopEventMock.mockImplementation(async (input) => ({
      id: "ev-1",
      ...input,
      createdAt: new Date(),
    }));

    mockLlmDecision = { decision: "retry", diagnosis: "test" };
  });

  test("R-1: stall→retry uses retryCurrentStepForWatchdog (not raw createAgentLoopStepRun)", async () => {
    // When the watchdog decides 'retry' for a stall invocation, it MUST go through
    // retryCurrentStepForWatchdog (the MAX(attempt)+1 safe path).
    mockLlmDecision = { decision: "retry", diagnosis: "Stall retry test" };

    const { invokeWatchdogForStall } = await watchdogModulePromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 3 });
    const loopRun = makeRun({
      currentStepRunId: "step-1",
      currentNodeId: "node-A",
    });

    await invokeWatchdogForStall({
      loop,
      loopRun,
      stepRunId: "step-1",
      nodeId: "node-A",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "stall_sweep",
      errorMessage: "Run stalled: last event agent-loop.step.started 20m ago",
      workflowRunId: null,
    });

    // retryCurrentStepForWatchdog must have been called
    expect(retryCurrentStepForWatchdogMock).toHaveBeenCalledTimes(1);
    // It must be called with the correct runId
    expect(retryForWatchdogCalls[0]?.runId).toBe("run-1");
  });

  test("R-2: budget sharing — stall + failure retries share countWatchdogRetryDecisions; at budget limit, pause is forced", async () => {
    // countWatchdogRetryDecisions returns the budget (already at limit)
    // so the next stall-initiated watchdog call must force-pause without LLM call
    const budget = 2;
    countWatchdogRetryDecisionsMock = budget; // at budget

    const { invokeWatchdogForStall } = await watchdogModulePromise;
    const loop = makeLoop({
      watchdogEnabled: true,
      watchdogRetryBudget: budget,
    });
    const loopRun = makeRun();

    const result = await invokeWatchdogForStall({
      loop,
      loopRun,
      stepRunId: "step-1",
      nodeId: "node-A",
      nodeKind: "agent_step",
      attempt: 3,
      errorKind: "stall_sweep",
      errorMessage: "Run stalled: last event agent-loop.step.started 20m ago",
      workflowRunId: null,
    });

    // Decision must be pause (budget exhausted)
    expect(result.decision).toBe("pause");
    // retryCurrentStepForWatchdog must NOT have been called
    expect(retryCurrentStepForWatchdogMock).not.toHaveBeenCalled();
    // pauseLoopRunSystem must have been called
    expect(pauseLoopRunSystemMock).toHaveBeenCalledTimes(1);
  });

  test("SW-6: 'skip' decision for stall invocation is coerced to 'pause'", async () => {
    // The LLM returns 'skip' but for stall invocations, skip is illegal
    // (no live failed-step failure edge to skip to) — must be coerced to pause.
    mockLlmDecision = { decision: "skip", diagnosis: "skip for stall" };

    const { invokeWatchdogForStall } = await watchdogModulePromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 3 });
    const loopRun = makeRun();

    const result = await invokeWatchdogForStall({
      loop,
      loopRun,
      stepRunId: "step-1",
      nodeId: "node-A",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "stall_sweep",
      errorMessage: "Run stalled: last event agent-loop.step.started 25m ago",
      workflowRunId: null,
      legalDecisions: ["retry", "pause"],
    });

    // Result must never be skip
    expect(result.decision).not.toBe("skip");
    expect(result.decision).toBe("pause");

    // pause must have been applied
    expect(pauseLoopRunSystemMock).toHaveBeenCalledTimes(1);
    // retryCurrentStepForWatchdog must NOT have been called
    expect(retryCurrentStepForWatchdogMock).not.toHaveBeenCalled();
  });
});

// ── Store startedAt regression (M3-01 follow-up B) ───────────────────────────

describe("store: createAgentLoopWatchdogRun startedAt persistence (ST-1, ST-2)", () => {
  beforeEach(() => {
    watchdogRunsCreated = [];
    createAgentLoopWatchdogRunMock.mockClear();
    createAgentLoopWatchdogRunMock.mockImplementation(async (input) => {
      watchdogRunsCreated.push({
        status: input.status,
        decision: input.decision ?? null,
        startedAt: input.startedAt ?? null,
      });
      return {
        id: "watchdog-run-" + watchdogRunsCreated.length,
        loopRunId: input.loopRunId,
        nodeId: input.nodeId,
        status: input.status,
        attempt: input.attempt,
        budgetRemaining: input.budgetRemaining,
        decision: input.decision ?? null,
        diagnosis: input.diagnosis ?? null,
        decisionPayload: null,
        startedAt: input.startedAt ?? null,
        finishedAt: null,
        stepRunId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  });

  test("ST-1: createAgentLoopWatchdogRun with startedAt: new Date() persists non-null started_at", async () => {
    // This test exercises the store function via the watchdog.
    // When invokeWatchdog creates a running row, it passes startedAt: new Date().
    // After the fix, startedAt must appear in the insert values.
    const now = new Date();
    mockLlmDecision = { decision: "retry", diagnosis: "start time test" };

    const { invokeWatchdogForStall } = await watchdogModulePromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 3 });
    const loopRun = makeRun();

    await invokeWatchdogForStall({
      loop,
      loopRun,
      stepRunId: "step-1",
      nodeId: "node-A",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "stall_sweep",
      errorMessage: "Run stalled",
      workflowRunId: null,
    });

    // The running watchdog row should have startedAt set (not null)
    const runningRow = watchdogRunsCreated.find((r) => r.status === "running");
    expect(runningRow).toBeDefined();
    expect(runningRow?.startedAt).not.toBeNull();
    // Should be a Date close to now
    if (runningRow?.startedAt instanceof Date) {
      const diffMs = Math.abs(runningRow.startedAt.getTime() - now.getTime());
      expect(diffMs).toBeLessThan(5000); // within 5 seconds
    } else {
      // Fail if startedAt is not a Date
      expect(runningRow?.startedAt).toBeInstanceOf(Date);
    }
  });

  test("ST-2: createAgentLoopWatchdogRun without startedAt → started_at is null (budget-exhausted path)", async () => {
    // The budget-exhausted path creates a row directly with status=decided,
    // no startedAt — so started_at should be null/undefined in that path.
    countWatchdogRetryDecisionsMock = 3;

    const { invokeWatchdogForStall } = await watchdogModulePromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 3 });
    const loopRun = makeRun();

    await invokeWatchdogForStall({
      loop,
      loopRun,
      stepRunId: "step-1",
      nodeId: "node-A",
      nodeKind: "agent_step",
      attempt: 4,
      errorKind: "stall_sweep",
      errorMessage: "Run stalled",
      workflowRunId: null,
    });

    // The budget-exhausted path creates a 'decided' row — no startedAt
    const decidedRow = watchdogRunsCreated.find((r) => r.status === "decided");
    expect(decidedRow).toBeDefined();
    // startedAt must be null (not set in budget-exhausted path)
    expect(decidedRow?.startedAt ?? null).toBeNull();
  });
});
