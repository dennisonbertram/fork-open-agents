/**
 * Agent Loops — watchdog.ts tests (M3-01)
 *
 * TDD RED — tests written before implementation.
 *
 * Decision matrix:
 *   WD-01: watchdogEnabled=false → invokeWatchdog returns { invoked: false } immediately
 *   WD-02: budget exhausted (prior retries >= watchdogRetryBudget) → forced pause, no agent call
 *   WD-03: retry decision → retryCurrentStepForWatchdog called + watchdog.decided emitted
 *   WD-04: skip decision with failure edge → advances to next node
 *   WD-05: skip decision with no failure edge → pause (graceful, not an error)
 *   WD-06: pause decision → run paused + diagnosis recorded
 *   WD-07: unparseable/invalid decision → pause with watchdog_output_invalid
 *   WD-08: agent throws AbortError → pause with watchdog_timeout
 *   WD-09: budget-termination property — total watchdog retries per node never exceed budget
 *   WD-10: invokeWatchdog throws → chain falls back to fail-fast (watchdog bug must never wedge a run)
 *
 * Plus:
 *   WD-11: watchdog.started event emitted before agent call
 *   WD-12: watchdog.decided event emitted after decision (info for retry/skip, warn for pause)
 *   WD-13: retry decision but retryCurrentStepForWatchdog THROWS → decision integrity
 *          (issue #763): the persisted row + watchdog.decided event must record
 *          decision='pause' (level warn) with payload.retry_dispatch_failed=true —
 *          never a phantom 'retry'.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Captured calls ────────────────────────────────────────────────────────────

let recordedEvents: Array<{
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
}> = [];

let watchdogRunsCreated: Array<{
  loopRunId: string;
  stepRunId?: string | null;
  nodeId: string;
  status: string;
  decision?: string | null;
  attempt: number;
  budgetRemaining: number;
}> = [];

let watchdogRunsUpdated: Array<{
  id: string;
  status?: string;
  decision?: string | null;
  diagnosis?: string | null;
  decisionPayload?: unknown;
  finishedAt?: Date;
}> = [];

let retryCallCount = 0;
let lastRetryHint: string | undefined = undefined;
let pauseCallCount = 0;
let advanceCallCount = 0;
let lastAdvanceNodeId: string | undefined = undefined;
let dispatchCallCount = 0;
let lastDispatchedStepRunId: string | undefined = undefined;

// Controls retry count returned by countWatchdogRetryDecisions
let mockRetryDecisionCount = 0;

// Controls what the "agent" returns
type MockAgentDecision = {
  decision: "retry" | "skip" | "pause";
  diagnosis: string;
  hint?: string;
};
let mockAgentDecision:
  | MockAgentDecision
  | "invalid"
  | "throw_abort"
  | "throw_generic" = { decision: "retry", diagnosis: "Test diagnosis" };

// ── Store mock ────────────────────────────────────────────────────────────────

let watchdogRunIdCounter = 0;

const createAgentLoopWatchdogRunMock = mock(
  async (input: {
    loopRunId: string;
    stepRunId?: string | null;
    nodeId: string;
    status: string;
    attempt: number;
    budgetRemaining: number;
    decision?: string | null;
    diagnosis?: string | null;
    decisionPayload?: unknown;
  }) => {
    const id = `watchdog-run-${++watchdogRunIdCounter}`;
    watchdogRunsCreated.push({
      loopRunId: input.loopRunId,
      stepRunId: input.stepRunId,
      nodeId: input.nodeId,
      status: input.status,
      decision: input.decision,
      attempt: input.attempt,
      budgetRemaining: input.budgetRemaining,
    });
    return { id, ...input, createdAt: new Date() };
  },
);

const updateAgentLoopWatchdogRunMock = mock(
  async (input: {
    id: string;
    status?: string;
    decision?: string | null;
    diagnosis?: string | null;
    decisionPayload?: unknown;
    finishedAt?: Date;
  }) => {
    watchdogRunsUpdated.push(input);
    return input;
  },
);

const countWatchdogRetryDecisionsMock = mock(
  async (_params: { loopRunId: string; nodeId: string }): Promise<number> => {
    return mockRetryDecisionCount;
  },
);

let retryCurrentStepForWatchdogShouldThrow = false;
const retryCurrentStepForWatchdogMock = mock(
  async (params: { runId: string; hint?: string }) => {
    retryCallCount++;
    lastRetryHint = params.hint;
    if (retryCurrentStepForWatchdogShouldThrow) {
      throw new Error("retryCurrentStepForWatchdog: TOCTOU race — rejected");
    }
    return { id: "new-step-run-1", attempt: 2, nodeId: "node-a" };
  },
);

let pauseTransitionWins = true;
const pauseLoopRunSystemMock = mock(async (_runId: string) => {
  pauseCallCount++;
  return pauseTransitionWins;
});

type MockStepRun = {
  id: string;
  loopRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
  status: string;
  stepInput: null;
  stepOutput: null;
  sandboxName: null;
  workflowRunId: null;
  errorKind: null;
  errorMessage: null;
  startedAt: null;
  finishedAt: null;
  durationMs: null;
  createdAt: Date;
};
type MockAdvanceResult =
  | { outcome: "advanced"; stepRun: MockStepRun }
  | { outcome: "no_failure_edge" }
  | { outcome: "race_lost" };

const advanceToFailureEdgeMock = mock(
  async (params: {
    loopRunId: string;
    expectedStepRunId: string;
    nodeId: string;
    snapshotDefinition: unknown;
  }): Promise<MockAdvanceResult> => {
    advanceCallCount++;
    lastAdvanceNodeId = params.nodeId;
    // Return a mock step run (the success case)
    return {
      outcome: "advanced",
      stepRun: {
        id: "failure-edge-step-run-1",
        loopRunId: params.loopRunId,
        nodeId: "node-b",
        nodeKind: "agent_step",
        attempt: 1,
        status: "queued",
        stepInput: null,
        stepOutput: null,
        sandboxName: null,
        workflowRunId: null,
        errorKind: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        createdAt: new Date(),
      },
    };
  },
);

const dispatchStepWorkflowMock = mock(async (stepRunId: string) => {
  dispatchCallCount++;
  lastDispatchedStepRunId = stepRunId;
  return true;
});

const recordAgentLoopEventMock = mock(
  async (input: {
    loopRunId: string;
    stepRunId?: string | null;
    nodeId?: string | null;
    eventName: string;
    status: string;
    level?: string;
    summary?: string | null;
    payload?: unknown;
  }) => {
    recordedEvents.push(input);
    return { id: `evt-${recordedEvents.length}`, ...input };
  },
);

let sourceLiveResults: boolean[] = [];
const isAgentLoopRunSourceLiveMock = mock(
  async () => sourceLiveResults.shift() ?? true,
);

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: isAgentLoopRunSourceLiveMock,
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  createAgentLoopWatchdogRun: createAgentLoopWatchdogRunMock,
  updateAgentLoopWatchdogRun: updateAgentLoopWatchdogRunMock,
  countWatchdogRetryDecisions: countWatchdogRetryDecisionsMock,
  retryCurrentStepForWatchdog: retryCurrentStepForWatchdogMock,
  pauseLoopRunSystem: pauseLoopRunSystemMock,
  advanceToFailureEdge: advanceToFailureEdgeMock,
  dispatchStepWorkflow: dispatchStepWorkflowMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  listWatchdogRunsForLoopRun: mock(async () => []),
}));

// ── Agent mock ────────────────────────────────────────────────────────────────

const generateTextMock = mock(async (_params: unknown) => {
  if (mockAgentDecision === "throw_abort") {
    const err = new Error("AbortError");
    err.name = "AbortError";
    throw err;
  }
  if (mockAgentDecision === "throw_generic") {
    throw new Error("Agent failure");
  }
  if (mockAgentDecision === "invalid") {
    return {
      finishReason: "stop",
      text: "This is not valid JSON decision output",
      steps: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }
  const decision = mockAgentDecision as MockAgentDecision;
  return {
    finishReason: "stop",
    text: JSON.stringify(decision),
    steps: [],
    usage: { promptTokens: 0, completionTokens: 0 },
  };
});

mock.module("ai", () => ({
  generateText: generateTextMock,
}));

mock.module("@open-agents/agent", () => ({
  sanitizeUnattendedToolCalls: (messages: unknown) => messages,
  gateway: mock(() => ({})),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLoop(
  overrides: Partial<
    AgentLoop & {
      watchdogEnabled: boolean;
      watchdogInstructions: string | null;
      watchdogRetryBudget: number;
    }
  > = {},
): AgentLoop & {
  watchdogEnabled: boolean;
  watchdogInstructions: string | null;
  watchdogRetryBudget: number;
} {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "my-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "loop-run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running",
    definitionSnapshot: {
      nodes: [
        {
          id: "node-a",
          kind: "agent_step",
          label: "Step A",
          position: { x: 0, y: 0 },
        },
        {
          id: "node-b",
          kind: "agent_step",
          label: "Step B",
          position: { x: 1, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "node-a", target: "node-b", when: "success" },
        { id: "e2", source: "node-a", target: "node-b", when: "failure" },
        { id: "e3", source: "node-b", target: "end", when: "success" },
      ],
    } as Record<string, unknown>,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: "node-a",
    currentStepRunId: "step-run-1",
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function resetAll() {
  recordedEvents = [];
  watchdogRunsCreated = [];
  watchdogRunsUpdated = [];
  retryCallCount = 0;
  lastRetryHint = undefined;
  pauseCallCount = 0;
  pauseTransitionWins = true;
  advanceCallCount = 0;
  lastAdvanceNodeId = undefined;
  dispatchCallCount = 0;
  lastDispatchedStepRunId = undefined;
  mockRetryDecisionCount = 0;
  mockAgentDecision = { decision: "retry", diagnosis: "Test diagnosis" };
  watchdogRunIdCounter = 0;
  retryCurrentStepForWatchdogShouldThrow = false;
  sourceLiveResults = [];

  createAgentLoopWatchdogRunMock.mockClear();
  updateAgentLoopWatchdogRunMock.mockClear();
  countWatchdogRetryDecisionsMock.mockClear();
  retryCurrentStepForWatchdogMock.mockClear();
  pauseLoopRunSystemMock.mockClear();
  advanceToFailureEdgeMock.mockClear();
  dispatchStepWorkflowMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  isAgentLoopRunSourceLiveMock.mockClear();
  generateTextMock.mockClear();

  // Reset advanceToFailureEdge to return a success step run by default
  advanceToFailureEdgeMock.mockImplementation(
    async (params: {
      loopRunId: string;
      expectedStepRunId: string;
      nodeId: string;
      snapshotDefinition: unknown;
    }): Promise<MockAdvanceResult> => {
      advanceCallCount++;
      lastAdvanceNodeId = params.nodeId;
      return {
        outcome: "advanced",
        stepRun: {
          id: "failure-edge-step-run-1",
          loopRunId: params.loopRunId,
          nodeId: "node-b",
          nodeKind: "agent_step",
          attempt: 1,
          status: "queued",
          stepInput: null,
          stepOutput: null,
          sandboxName: null,
          workflowRunId: null,
          errorKind: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          createdAt: new Date(),
        },
      };
    },
  );
}

// Import watchdog after all mocks are set up
const watchdogPromise = import("./watchdog");

describe("watchdog source deletion race guard", () => {
  beforeEach(resetAll);

  test("deletion after diagnosis prevents every decision mutation", async () => {
    sourceLiveResults = [true, false];
    const { invokeWatchdog } = await watchdogPromise;

    const result = await invokeWatchdog({
      loop: makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 }),
      loopRun: makeLoopRun(),
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result.invoked).toBe(false);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(retryCurrentStepForWatchdogMock).not.toHaveBeenCalled();
    expect(pauseLoopRunSystemMock).not.toHaveBeenCalled();
    expect(advanceToFailureEdgeMock).not.toHaveBeenCalled();
    expect(dispatchStepWorkflowMock).not.toHaveBeenCalled();
    expect(watchdogRunsUpdated).toContainEqual(
      expect.objectContaining({
        id: "watchdog-run-1",
        status: "failed",
        diagnosis: "Loop execution authorization was revoked.",
        finishedAt: expect.any(Date),
      }),
    );
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WD-01: watchdogEnabled=false → invokeWatchdog returns immediately without agent call", () => {
  beforeEach(resetAll);

  test("returns { invoked: false } when watchdogEnabled is false", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: false });
    const loopRun = makeLoopRun();

    const result = await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result.invoked).toBe(false);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createAgentLoopWatchdogRunMock).not.toHaveBeenCalled();
  });

  test("does not emit any events when watchdogEnabled is false", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: false });
    const loopRun = makeLoopRun();

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(recordedEvents).toHaveLength(0);
  });
});

describe("WD-02: budget exhausted → forced pause without agent call", () => {
  beforeEach(resetAll);

  test("when prior retries >= budget, pause without invoking agent", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockRetryDecisionCount = 2; // at budget

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(pauseCallCount).toBe(1);
  });

  test("budget exhaustion: watchdog row created with decided/pause status", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockRetryDecisionCount = 2;

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    // A watchdog run should be created with decision=pause (budget exhausted)
    const created = watchdogRunsCreated.find((r) => r.nodeId === "node-a");
    expect(created).toBeDefined();
    expect(created?.decision).toBe("pause");
  });

  test("budget exhaustion: emits watchdog.started and watchdog.decided events", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockRetryDecisionCount = 2;

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const startedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.started",
    );
    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(startedEvent).toBeDefined();
    expect(decidedEvent).toBeDefined();
  });
});

describe("WD-03: retry decision → retryCurrentStepForWatchdog called", () => {
  beforeEach(resetAll);

  test("retry decision invokes retry store function", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = {
      decision: "retry",
      diagnosis: "Retry this step",
      hint: "Try a different approach",
    };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(retryCallCount).toBe(1);
    expect(lastRetryHint).toBe("Try a different approach");
  });

  test("retry decision requires the failed step id in the store compare-and-set", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun({ currentStepRunId: "step-run-1" });
    mockAgentDecision = {
      decision: "retry",
      diagnosis: "Retry this step",
      hint: "Try a different approach",
    };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(retryCurrentStepForWatchdogMock).toHaveBeenCalledWith({
      runId: loopRun.id,
      expectedStepRunId: "step-run-1",
      hint: "Try a different approach",
    });
  });

  test("retry decision emits watchdog.decided event at info level", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry needed" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent).toBeDefined();
    expect(decidedEvent?.level).toBe("info");
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["decision"]).toBe("retry");
  });

  test("retry decision persists hint in watchdog run row", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = {
      decision: "retry",
      diagnosis: "Retry needed",
      hint: "Focus on the API rate limit",
    };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const updated = watchdogRunsUpdated.find((r) => r.decision === "retry");
    expect(updated).toBeDefined();
  });
});

describe("WD-04: skip decision with failure edge → advances to next node", () => {
  beforeEach(resetAll);

  test("skip with failure edge advances to next node", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun(); // has failure edge from node-a
    mockAgentDecision = { decision: "skip", diagnosis: "Skip this step" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(advanceCallCount).toBe(1);
    expect(lastAdvanceNodeId).toBe("node-a");
  });

  test("skip decision emits watchdog.decided at info level", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "skip", diagnosis: "Skipping" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent?.level).toBe("info");
  });

  test("WD-04: skip with failure edge dispatches the queued step run", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "skip", diagnosis: "Skip this step" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    // dispatchStepWorkflow should have been called with the step run id from advanceToFailureEdge
    expect(dispatchCallCount).toBe(1);
    expect(lastDispatchedStepRunId).toBe("failure-edge-step-run-1");
  });

  test("WD-04: skip with failure edge emits chain.dispatched event", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "skip", diagnosis: "Skip this step" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const dispatchedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatched",
    );
    expect(dispatchedEvent).toBeDefined();
    const payload = dispatchedEvent?.payload as Record<string, unknown>;
    expect(payload?.["via"]).toBe("watchdog_skip");
  });

  test("cancellation during diagnosis prevents skip advance and all decision evidence", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    mockAgentDecision = { decision: "skip", diagnosis: "Skip this step" };
    advanceToFailureEdgeMock.mockResolvedValueOnce({ outcome: "race_lost" });

    const result = await invokeWatchdog({
      loop: makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 }),
      loopRun: makeLoopRun(),
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result).toEqual({ invoked: false });
    expect(dispatchStepWorkflowMock).not.toHaveBeenCalled();
    expect(
      recordedEvents.some(
        (event) =>
          event.eventName === "agent-loop.watchdog.decided" ||
          event.eventName === "agent-loop.chain.dispatched",
      ),
    ).toBe(false);
    expect(watchdogRunsUpdated).toContainEqual(
      expect.objectContaining({
        status: "failed",
        finishedAt: expect.any(Date),
      }),
    );
  });

  test("cancellation after skip advance prevents dispatch and decided evidence", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    mockAgentDecision = { decision: "skip", diagnosis: "Skip this step" };
    dispatchStepWorkflowMock.mockResolvedValueOnce(false);

    const result = await invokeWatchdog({
      loop: makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 }),
      loopRun: makeLoopRun(),
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result).toEqual({ invoked: false });
    expect(dispatchStepWorkflowMock).toHaveBeenCalledTimes(1);
    expect(
      recordedEvents.some(
        (event) =>
          event.eventName === "agent-loop.watchdog.decided" ||
          event.eventName === "agent-loop.chain.dispatched",
      ),
    ).toBe(false);
  });
});

describe("WD-05: skip decision with no failure edge → pause (graceful)", () => {
  beforeEach(resetAll);

  test("skip with no failure edge → pauses, does not error", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    // Make a loop run whose snapshot has no failure edge from node-b
    const loopRun = makeLoopRun({
      currentNodeId: "node-b",
      definitionSnapshot: {
        nodes: [
          {
            id: "node-b",
            kind: "agent_step",
            label: "B",
            position: { x: 0, y: 0 },
          },
          { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
        ],
        edges: [
          // only success edge, no failure edge from node-b
          { id: "e1", source: "node-b", target: "end", when: "success" },
        ],
      } as Record<string, unknown>,
    });
    mockAgentDecision = {
      decision: "skip",
      diagnosis: "Skip but no failure edge",
    };

    // Override: advanceToFailureEdge returns null (no failure edge exists)
    advanceToFailureEdgeMock.mockImplementation(
      async (_params: {
        loopRunId: string;
        nodeId: string;
        snapshotDefinition: unknown;
        expectedStepRunId: string;
      }): Promise<MockAdvanceResult> => {
        advanceCallCount++;
        lastAdvanceNodeId = "node-b";
        return { outcome: "no_failure_edge" };
      },
    );

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-b",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    // Should pause, not advance (advance was called but returned false)
    expect(pauseCallCount).toBe(1);
  });
});

describe("WD-06: pause decision → run paused + watchdog.decided emitted", () => {
  beforeEach(resetAll);

  test("pause decision calls pauseLoopRunSystem", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "pause", diagnosis: "Manual pause needed" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(pauseCallCount).toBe(1);
    expect(retryCallCount).toBe(0);
  });

  test("pause decision emits watchdog.decided at warn level", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = {
      decision: "pause",
      diagnosis: "Needs human attention",
    };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent).toBeDefined();
    expect(decidedEvent?.level).toBe("warn");
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["decision"]).toBe("pause");
  });

  test("chain failure during diagnosis cannot be resurrected to paused", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    pauseTransitionWins = false;
    mockAgentDecision = { decision: "pause", diagnosis: "Pause it" };

    const result = await invokeWatchdog({
      loop: makeLoop({ watchdogEnabled: true }),
      loopRun: makeLoopRun(),
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result).toEqual({ invoked: false });
    expect(
      recordedEvents.some(
        (event) => event.eventName === "agent-loop.watchdog.decided",
      ),
    ).toBe(false);
    expect(watchdogRunsUpdated).toContainEqual(
      expect.objectContaining({ status: "failed" }),
    );
  });
});

describe("WD-07: unparseable/invalid decision → pause with watchdog_output_invalid", () => {
  beforeEach(resetAll);

  test("invalid JSON from agent → pause applied", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = "invalid";

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(pauseCallCount).toBe(1);
    expect(retryCallCount).toBe(0);
  });

  test("invalid output → watchdog.decided emitted at warn level with errorKind=watchdog_output_invalid", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = "invalid";

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent?.level).toBe("warn");
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["errorKind"]).toBe("watchdog_output_invalid");
  });
});

describe("WD-08: agent throws AbortError → pause with watchdog_timeout", () => {
  beforeEach(resetAll);

  test("AbortError → pause applied", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = "throw_abort";

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(pauseCallCount).toBe(1);
    expect(retryCallCount).toBe(0);
  });

  test("AbortError → watchdog.decided emitted with errorKind=watchdog_timeout", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = "throw_abort";

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["errorKind"]).toBe("watchdog_timeout");
  });
});

describe("WD-09: budget-termination property — retries never exceed budget", () => {
  beforeEach(resetAll);

  test("property: for any sequence of calls, total watchdog retries per node never exceed the budget", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const budget = 2;
    const loop = makeLoop({
      watchdogEnabled: true,
      watchdogRetryBudget: budget,
    });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry" };

    // Simulate a sequence where we track how many retries the system would track
    // by controlling the mockRetryDecisionCount incrementally
    let trackedRetries = 0;

    for (let i = 0; i < 5; i++) {
      mockRetryDecisionCount = trackedRetries;
      retryCallCount = 0;

      await invokeWatchdog({
        loop,
        loopRun,
        stepRunId: `step-run-${i}`,
        nodeId: "node-a",
        nodeKind: "agent_step",
        attempt: i + 1,
        errorKind: "step_failed",
        errorMessage: "Step failed",
        workflowRunId: "wf-1",
      });

      if (trackedRetries < budget) {
        // Should have retried
        expect(retryCallCount).toBe(1);
        trackedRetries++;
      } else {
        // Budget exhausted — should have paused, NOT retried
        expect(retryCallCount).toBe(0);
        expect(pauseCallCount).toBeGreaterThan(0);
        pauseCallCount = 0;
      }
    }

    // Final check: total retries tracked == budget
    expect(trackedRetries).toBe(budget);
  });
});

describe("WD-10: invokeWatchdog throws → chain should fall back to fail-fast", () => {
  beforeEach(resetAll);

  test("invokeWatchdog with a generic throw still resolves (does not propagate throws by default)", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    // Make the agent throw generically — the watchdog itself should handle it gracefully
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = "throw_generic";

    // Should not throw — should gracefully fall back to pause
    const result = await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    expect(result.invoked).toBe(true);
  });
});

describe("WD-11: watchdog.started event emitted before agent call", () => {
  beforeEach(resetAll);

  test("watchdog.started is emitted with correct payload", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const startedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.started",
    );
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.status).toBe("info");
    const payload = startedEvent?.payload as Record<string, unknown>;
    expect(payload?.["loopRunId"]).toBe("loop-run-1");
    expect(payload?.["nodeId"]).toBe("node-a");
    expect(payload?.["attempt"]).toBe(1);
  });
});

describe("WD-12: watchdog.decided event emitted after decision", () => {
  beforeEach(resetAll);

  test("watchdog.decided includes hasHint boolean in payload", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = {
      decision: "retry",
      diagnosis: "Retry now",
      hint: "Use exponential backoff",
    };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent).toBeDefined();
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["hasHint"]).toBe(true);
  });

  test("watchdog.decided budgetRemaining is included in payload", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 3 });
    const loopRun = makeLoopRun();
    mockRetryDecisionCount = 1; // 1 prior retry, 2 remaining
    mockAgentDecision = { decision: "retry", diagnosis: "Retry" };

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 2,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(typeof payload?.["budgetRemaining"]).toBe("number");
  });
});

describe("WD-13: retry decision but retryCurrentStepForWatchdog throws — decision integrity (issue #763)", () => {
  beforeEach(resetAll);

  test("retry-dispatch throw → persisted watchdog row records decision=pause (not phantom retry)", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry this step" };
    retryCurrentStepForWatchdogShouldThrow = true;

    const result = await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    // The function's own return must not claim retry succeeded.
    expect(result.decision).toBe("pause");

    // The persisted watchdog run row must be updated with decision=pause.
    const updated = watchdogRunsUpdated.at(-1);
    expect(updated?.decision).toBe("pause");
    expect(updated?.status).toBe("decided");

    // pauseLoopRunSystem must have been called (fallback pause applied).
    expect(pauseCallCount).toBe(1);
  });

  test("retry-dispatch throw → watchdog.decided event records decision=pause at level warn with retry_dispatch_failed marker", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry this step" };
    retryCurrentStepForWatchdogShouldThrow = true;

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const decidedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.watchdog.decided",
    );
    expect(decidedEvent).toBeDefined();
    expect(decidedEvent?.level).toBe("warn");
    const payload = decidedEvent?.payload as Record<string, unknown>;
    expect(payload?.["decision"]).toBe("pause");
    expect(payload?.["retry_dispatch_failed"]).toBe(true);
  });

  test("retry-dispatch throw → no chain.dispatched event is emitted (nothing was actually dispatched)", async () => {
    const { invokeWatchdog } = await watchdogPromise;
    const loop = makeLoop({ watchdogEnabled: true, watchdogRetryBudget: 2 });
    const loopRun = makeLoopRun();
    mockAgentDecision = { decision: "retry", diagnosis: "Retry this step" };
    retryCurrentStepForWatchdogShouldThrow = true;

    await invokeWatchdog({
      loop,
      loopRun,
      stepRunId: "step-run-1",
      nodeId: "node-a",
      nodeKind: "agent_step",
      attempt: 1,
      errorKind: "step_failed",
      errorMessage: "Step failed",
      workflowRunId: "wf-1",
    });

    const dispatchedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatched",
    );
    expect(dispatchedEvent).toBeUndefined();
    expect(dispatchCallCount).toBe(0);
  });
});
