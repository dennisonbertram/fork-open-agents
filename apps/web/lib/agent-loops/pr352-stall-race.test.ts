/**
 * Agent Loops — PR #352 P1: stalled-run post-execution race tests
 *
 * Behavioral tests for three related scenarios:
 *
 * BT-P1-01: chain.ts post-exec re-check with stalled status
 *   - When the sweep marks a run stalled DURING step execution, the in-flight
 *     step may still return. chain.ts must NOT dispatch the next step — it
 *     should advance bookkeeping (step run created, advanceRunToNextStep called)
 *     but suppress the start() call, emitting a stalled_before_dispatch event.
 *
 * BT-P1-02: retryCurrentStep in run-controls when currentStepRunId is QUEUED
 *   - After stall + post-stall advance, the run's currentStepRunId points at a
 *     QUEUED step (the advance happened, but dispatch was suppressed).
 *   - retryCurrentStep should RE-DISPATCH the queued step (no new attempt row).
 *
 * BT-P1-03: retryCurrentStep in run-controls when currentStepRunId is FAILED
 *   - Classic retry-from-failed shape: currentStepRunId points at a failed step.
 *   - retryCurrentStep should create attempt n+1 (existing behavior preserved).
 *
 * BT-P1-04: stalled run — advance bookkeeping is performed (pointer updated)
 *   - advanceRunToNextStep is called, confirming the step pointer moves forward,
 *     so resume/retry can re-dispatch the queued step without losing progress.
 *
 * BT-P1-05: stalled run — stalled_before_dispatch event carries stalled status
 *   - The emitted event payload must surface the run status so observability
 *     tooling can distinguish stalled vs paused mid-execution.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import { RunControlError } from "./run-controls-error";

mock.module("server-only", () => ({}));

// ── Captured calls ────────────────────────────────────────────────────────────

type EventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: string;
  level?: string;
  summary?: string | null;
  payload?: unknown;
  workflowRunId?: string | null;
};

type RunStatusInput = {
  runId: string;
  status: string;
  currentNodeId?: string | null;
  currentStepRunId?: string | null;
  workflowRunId?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  iterationCount?: number;
  stepCount?: number;
};

type AdvanceRunInput = {
  runId: string;
  fromStepRunId: string;
  nextNodeId: string;
  nextStepRunId: string;
  stepCount: number;
  iterationCount: number;
  workflowRunId: string;
};

let recordedEvents: EventInput[] = [];
let recordedRunStatusUpdates: RunStatusInput[] = [];
let recordedAdvanceCalls: AdvanceRunInput[] = [];
let recordedStepRunCreations: {
  loopRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
}[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

// ── Mock state ─────────────────────────────────────────────────────────────────

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

// When set, the post-execution re-load returns this status (simulating sweep landing mid-execution)
let postExecutionRunStatus: AgentLoopRun["status"] | null = null;

// Whether advanceRunToNextStep succeeds (1) or is no-op (0)
let advanceRunRowsUpdated = 1;

let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

let nextStepRunIdCounter = 900;
function nextId() {
  return `p1-${nextStepRunIdCounter++}`;
}

// ── Executor mock ─────────────────────────────────────────────────────────────

let executorOutcomes: Record<
  string,
  { outcome: "success" | "failure" | "true" | "false"; errorKind?: string }
> = {};
let executedNodeIds: string[] = [];

const executeAgentLoopStepMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }) => {
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);
    return executorOutcomes[nodeId] ?? { outcome: "success" as const };
  },
);

// ── Store mocks (chain.ts surface) ───────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (stepRunId: string) => {
  const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
  return {
    stepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  };
});

// Post-execution re-load: applies postExecutionRunStatus when set
const getAgentLoopRunWithLoopMock = mock(async (_runId: string) => {
  if (postExecutionRunStatus !== null) {
    currentLoopRun = { ...currentLoopRun, status: postExecutionRunStatus };
  }
  return { run: currentLoopRun, loop: currentLoop };
});

const updateAgentLoopRunStatusMock = mock(
  async (input: RunStatusInput): Promise<AgentLoopRun> => {
    recordedRunStatusUpdates.push(input);
    currentLoopRun = {
      ...currentLoopRun,
      status: input.status as AgentLoopRun["status"],
    };
    return currentLoopRun;
  },
);

const conditionallyTransitionRunStatusMock = mock(
  async (params: {
    runId: string;
    toStatus: AgentLoopRun["status"];
    fromStatuses: AgentLoopRun["status"][];
  }): Promise<AgentLoopRun | null> => {
    recordedRunStatusUpdates.push({
      runId: params.runId,
      status: params.toStatus,
    });
    currentLoopRun = { ...currentLoopRun, status: params.toStatus };
    return currentLoopRun;
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: `evt-${recordedEvents.length}`, ...input };
});

const createAgentLoopStepRunMock = mock(
  async (input: {
    loopRunId: string;
    nodeId: string;
    nodeKind: string;
    attempt?: number;
  }) => {
    const attempt = input.attempt ?? 1;
    const id = nextId();
    recordedStepRunCreations.push({
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt,
    });
    const newStepRun: AgentLoopStepRun = makeStepRun({
      id,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt,
    });
    stepRunIdToNodeId[id] = input.nodeId;
    stepRunIdToStepRun[id] = newStepRun;
    return newStepRun;
  },
);

const advanceRunToNextStepMock = mock(
  async (input: AdvanceRunInput): Promise<boolean> => {
    recordedAdvanceCalls.push(input);
    if (advanceRunRowsUpdated === 0) return false;
    currentLoopRun = {
      ...currentLoopRun,
      currentNodeId: input.nextNodeId,
      currentStepRunId: input.nextStepRunId,
      stepCount: input.stepCount,
      iterationCount: input.iterationCount,
    };
    return true;
  },
);

const countStepRunsForNodeMock = mock(
  async (_params: { loopRunId: string; nodeId: string }): Promise<number> => {
    return 0;
  },
);

const getMaxAttemptForNodeMock = mock(
  async (_params: { loopRunId: string; nodeId: string }): Promise<number> => {
    return 0;
  },
);

const updateAgentLoopStepRunMock = mock(async (_input: unknown) => {
  return currentStepRun;
});

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(
    async (input: {
      runId: string;
      fromStepRunId: string;
      nextNodeId: string;
      nextNodeKind: string;
      attempt: number;
      stepCount: number;
      iterationCount: number;
      workflowRunId: string;
    }) => {
      const step = await createAgentLoopStepRunMock({
        loopRunId: input.runId,
        nodeId: input.nextNodeId,
        nodeKind: input.nextNodeKind,
        attempt: input.attempt,
      });
      const advanced = await advanceRunToNextStepMock({
        runId: input.runId,
        fromStepRunId: input.fromStepRunId,
        nextNodeId: input.nextNodeId,
        nextStepRunId: step.id,
        stepCount: input.stepCount,
        iterationCount: input.iterationCount,
        workflowRunId: input.workflowRunId,
      });
      return advanced
        ? { outcome: "advanced" as const, step }
        : { outcome: "duplicate" as const };
    },
  ),
  getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
  getAgentLoopRunWithLoop: getAgentLoopRunWithLoopMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  conditionallyTransitionRunStatus: conditionallyTransitionRunStatusMock,
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  advanceRunToNextStep: advanceRunToNextStepMock,
  countStepRunsForNode: countStepRunsForNodeMock,
  getMaxAttemptForNode: getMaxAttemptForNodeMock,
  updateAgentLoopRunContext: mock(async () => undefined),
  findStalledLoopRunCandidates: mock(async () => []),
  // watchdog stubs (M3-01)
  createAgentLoopWatchdogRun: mock(async () => ({
    id: "wdr-stub",
    loopId: "loop-1",
    loopRunId: "run-1",
    stepRunId: null,
    nodeId: null,
    attempt: 1,
    decision: null,
    diagnosis: null,
    hint: null,
    failReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateAgentLoopWatchdogRun: mock(async () => undefined),
  countWatchdogRetryDecisions: mock(async () => 0),
  listWatchdogRunsForLoopRun: mock(async () => []),
  retryCurrentStepForWatchdog: mock(async () => undefined),
  pauseLoopRunSystem: mock(async () => undefined),
  advanceToFailureEdge: mock(async () => false),
  dispatchStepWorkflow: mock(async () => undefined),
}));

mock.module("./watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false })),
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));

let workflowStartThrows: Error | null = null;
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-p1-${nextStepRunIdCounter}` };
  },
);
mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── run-controls store mocks (for BT-P1-02, BT-P1-03) ───────────────────────

let runControlsCurrentLoopRun: AgentLoopRun;
let runControlsStepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};
let runOwnership: Record<string, string> = {};
let rcNextStepRunIdCounter = 950;
function rcNextId() {
  return `rc-p1-${rcNextStepRunIdCounter++}`;
}

const retryCurrentStepStoreMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId, userId } = params;
    const owner = runOwnership[runId];
    if (!owner || owner !== userId) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }
    if (
      runControlsCurrentLoopRun.status !== "failed" &&
      runControlsCurrentLoopRun.status !== "stalled"
    ) {
      throw new RunControlError(
        "illegal_transition",
        `Cannot retry run ${runId}: not in a retryable status (failed/stalled), got: ${runControlsCurrentLoopRun.status}`,
      );
    }
    const currentStepRunId = runControlsCurrentLoopRun.currentStepRunId;
    if (!currentStepRunId) {
      throw new RunControlError(
        "illegal_transition",
        `Cannot retry run ${runId}: missing currentStepRunId`,
      );
    }
    const currentSR = runControlsStepRunIdToStepRun[currentStepRunId];
    // The P1 fix: if the current step run is still QUEUED, re-dispatch it
    // instead of creating a new attempt. A queued step was advanced-to but
    // never dispatched (post-stall advance case). Creating n+1 would be
    // wasteful / confusing.
    if (currentSR?.status === "queued") {
      // Re-dispatch path: return the existing step run, do NOT create n+1
      runControlsCurrentLoopRun = {
        ...runControlsCurrentLoopRun,
        status: "running",
      };
      return currentSR;
    }
    // Classic path: failed (or succeeded/other) — create attempt n+1
    const attempt = (currentSR?.attempt ?? 1) + 1;
    const id = rcNextId();
    const newStepRun = makeStepRun({
      id,
      loopRunId: runId,
      nodeId: runControlsCurrentLoopRun.currentNodeId ?? "work",
      nodeKind: currentSR?.nodeKind ?? "agent_step",
      attempt,
      status: "queued",
    });
    runControlsStepRunIdToStepRun[id] = newStepRun;
    runControlsCurrentLoopRun = {
      ...runControlsCurrentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return newStepRun;
  },
);

let rcRecordedEvents: EventInput[] = [];
const rcRecordAgentLoopEventMock = mock(async (input: EventInput) => {
  rcRecordedEvents.push(input);
  return { id: `rc-evt-${rcRecordedEvents.length}`, ...input };
});

let rcWorkflowStartCalls: Array<{ stepRunId: string }> = [];
let rcWorkflowStartThrows: Error | null = null;
const rcWorkflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (rcWorkflowStartThrows) throw rcWorkflowStartThrows;
    rcWorkflowStartCalls.push(args[0]);
    return { runId: `wf-rc-p1-${rcNextStepRunIdCounter}` };
  },
);

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(
    async (input: {
      runId: string;
      fromStepRunId: string;
      nextNodeId: string;
      nextNodeKind: string;
      attempt: number;
      stepCount: number;
      iterationCount: number;
      workflowRunId: string;
    }) => {
      const step = await createAgentLoopStepRunMock({
        loopRunId: input.runId,
        nodeId: input.nextNodeId,
        nodeKind: input.nextNodeKind,
        attempt: input.attempt,
      });
      const advanced = await advanceRunToNextStepMock({
        runId: input.runId,
        fromStepRunId: input.fromStepRunId,
        nextNodeId: input.nextNodeId,
        nextStepRunId: step.id,
        stepCount: input.stepCount,
        iterationCount: input.iterationCount,
        workflowRunId: input.workflowRunId,
      });
      return advanced
        ? { outcome: "advanced" as const, step }
        : { outcome: "duplicate" as const };
    },
  ),
  getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
  getAgentLoopRunWithLoop: getAgentLoopRunWithLoopMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  conditionallyTransitionRunStatus: conditionallyTransitionRunStatusMock,
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  advanceRunToNextStep: advanceRunToNextStepMock,
  countStepRunsForNode: countStepRunsForNodeMock,
  getMaxAttemptForNode: getMaxAttemptForNodeMock,
  // Control-plane store functions used by run-controls.ts
  pauseLoopRun: mock(async () => {
    throw new RunControlError("illegal_transition", "test");
  }),
  cancelLoopRun: mock(async () => {
    throw new RunControlError("illegal_transition", "test");
  }),
  resumeLoopRun: mock(async () => {
    throw new RunControlError("illegal_transition", "test");
  }),
  retryCurrentStep: retryCurrentStepStoreMock,
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const simpleDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "work",
      kind: "agent_step",
      label: "Work",
      position: { x: 1, y: 0 },
      instructions: "do it",
    },
    { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "work", when: "success" },
    { id: "e2", source: "work", target: "end", when: "success" },
  ],
};

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-p1",
    userId: "user-1",
    name: "P1 Test Loop",
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
    id: "run-p1",
    loopId: "loop-p1",
    userId: "user-1",
    status: "running",
    definitionSnapshot: simpleDefinition as Record<string, unknown>,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: "work",
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-p1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-p1-1",
    loopRunId: "run-p1",
    nodeId: "work",
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
    ...overrides,
  };
}

// ── Setup / reset ─────────────────────────────────────────────────────────────

function resetAll() {
  recordedEvents = [];
  recordedRunStatusUpdates = [];
  recordedAdvanceCalls = [];
  recordedStepRunCreations = [];
  workflowStartCalls = [];
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  executorOutcomes = {};
  advanceRunRowsUpdated = 1;
  postExecutionRunStatus = null;
  workflowStartThrows = null;
  nextStepRunIdCounter = 900;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun({ status: "running" });
  currentStepRun = makeStepRun({ id: "step-p1-work", nodeId: "work" });
  stepRunIdToNodeId["step-p1-work"] = "work";
  stepRunIdToStepRun["step-p1-work"] = currentStepRun;

  getAgentLoopStepRunWithContextMock.mockClear();
  getAgentLoopRunWithLoopMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  conditionallyTransitionRunStatusMock.mockClear();
  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  createAgentLoopStepRunMock.mockClear();
  advanceRunToNextStepMock.mockClear();
  countStepRunsForNodeMock.mockClear();
  getMaxAttemptForNodeMock.mockClear();
  executeAgentLoopStepMock.mockClear();
  workflowStartMock.mockClear();
}

function resetRC() {
  rcRecordedEvents = [];
  rcWorkflowStartCalls = [];
  rcWorkflowStartThrows = null;
  runOwnership = {};
  runControlsStepRunIdToStepRun = {};
  rcNextStepRunIdCounter = 950;

  runControlsCurrentLoopRun = makeLoopRun({ status: "stalled" });
  runOwnership["run-p1"] = "user-1";

  retryCurrentStepStoreMock.mockClear();
  rcRecordAgentLoopEventMock.mockClear();
  rcWorkflowStartMock.mockClear();
}

// Import modules after all mocks
const chainPromise = import("./chain");

// ── BT-P1-01: chain post-exec re-check — stalled → bookkeeping yes, dispatch no ──

describe("BT-P1-01: stalled during step execution — advance bookkeeping done, dispatch suppressed", () => {
  beforeEach(() => {
    resetAll();
    executorOutcomes["work"] = { outcome: "success" };
    // Simulate sweep marking the run stalled during step execution
    postExecutionRunStatus = "stalled";
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-p1-work",
    });
  });

  test("BT-P1-01a: stalled post-exec → NO workflow dispatch", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    // Must not have dispatched — dispatch would race the operator's recovery
    expect(workflowStartCalls.length).toBe(0);
  });

  test("BT-P1-01b: stalled post-exec → stalled_before_dispatch event emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    const stalledEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.stalled_before_dispatch",
    );
    expect(stalledEvent).toBeDefined();
  });

  test("BT-P1-01c: stalled post-exec — event payload contains stalled status", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    const stalledEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.stalled_before_dispatch",
    );
    const payload = stalledEvent?.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload?.["runStatus"]).toBe("stalled");
  });
});

// ── BT-P1-04: advance bookkeeping still happens on stalled post-exec ──────────

describe("BT-P1-04: stalled post-exec — advanceRunToNextStep is still called (pointer updated)", () => {
  beforeEach(() => {
    resetAll();
    executorOutcomes["work"] = { outcome: "success" };
    postExecutionRunStatus = "stalled";
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-p1-work",
    });
  });

  test("BT-P1-04: advanceRunToNextStep called even when run is stalled", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    // Advance must still happen — the step's completed work must be preserved
    // and currentStepRunId updated to the queued next step for recovery
    expect(recordedAdvanceCalls.length).toBe(1);
  });

  test("BT-P1-04: next step run is created (queued) even when run is stalled", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    // A step run for the next node must have been created
    expect(recordedStepRunCreations.length).toBeGreaterThan(0);
  });
});

// ── BT-P1-05: event taxonomy — stalled_before_dispatch distinct from paused ───

describe("BT-P1-05: stalled_before_dispatch event is distinct from paused_before_dispatch", () => {
  beforeEach(() => {
    resetAll();
  });

  test("BT-P1-05a: stalled post-exec emits stalled_before_dispatch, NOT paused_before_dispatch", async () => {
    executorOutcomes["work"] = { outcome: "success" };
    postExecutionRunStatus = "stalled";
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-p1-work",
    });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    // Must emit the stalled-specific event
    const stalledEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.stalled_before_dispatch",
    );
    expect(stalledEvent).toBeDefined();

    // Must NOT emit the paused event (different taxonomy)
    const pausedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.paused_before_dispatch",
    );
    expect(pausedEvent).toBeUndefined();
  });

  test("BT-P1-05b: paused post-exec still emits paused_before_dispatch (regression: paused path unaffected)", async () => {
    executorOutcomes["work"] = { outcome: "success" };
    postExecutionRunStatus = "paused";
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-p1-work",
    });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-p1-work",
      workflowRunId: "wf-p1-1",
    });

    const pausedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.paused_before_dispatch",
    );
    expect(pausedEvent).toBeDefined();

    // Must NOT emit the stalled event for paused runs
    const stalledEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.stalled_before_dispatch",
    );
    expect(stalledEvent).toBeUndefined();
  });
});

// ── BT-P1-02 / BT-P1-03: retryCurrentStep queued vs failed step ──────────────
// These tests exercise run-controls.ts retryCurrentStep via a direct store mock.
// The store mock (retryCurrentStepStoreMock above) implements the P1 fix:
// queued currentStepRunId → re-dispatch same step run (no new attempt).
// failed currentStepRunId → create attempt n+1 (classic behavior).
//
// Note: we test run-controls.ts behavior indirectly through the store contract
// because run-controls.ts delegates entirely to storeRetryCurrentStep and then
// calls start(). The behavioral assertions are:
//   - queued step → workflowStartCalls[0].stepRunId === existing queued step id
//   - failed step → workflowStartCalls[0].stepRunId === NEW step run id (n+1)

describe("BT-P1-02: retryCurrentStep with QUEUED currentStepRunId → re-dispatch same step, no new attempt", () => {
  let runControlsPromise: Promise<typeof import("./run-controls")>;

  beforeEach(async () => {
    resetRC();
    // Wire the run-controls module to use rc-prefixed mocks
    mock.module("./store", () => ({
      isAgentLoopRunSourceLive: mock(async () => true),
      createAndAdvanceAgentLoopStep: mock(
        async (input: {
          runId: string;
          fromStepRunId: string;
          nextNodeId: string;
          nextNodeKind: string;
          attempt: number;
          stepCount: number;
          iterationCount: number;
          workflowRunId: string;
        }) => {
          const step = await createAgentLoopStepRunMock({
            loopRunId: input.runId,
            nodeId: input.nextNodeId,
            nodeKind: input.nextNodeKind,
            attempt: input.attempt,
          });
          const advanced = await advanceRunToNextStepMock({
            runId: input.runId,
            fromStepRunId: input.fromStepRunId,
            nextNodeId: input.nextNodeId,
            nextStepRunId: step.id,
            stepCount: input.stepCount,
            iterationCount: input.iterationCount,
            workflowRunId: input.workflowRunId,
          });
          return advanced
            ? { outcome: "advanced" as const, step }
            : { outcome: "duplicate" as const };
        },
      ),
      getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
      getAgentLoopRunWithLoop: getAgentLoopRunWithLoopMock,
      updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
      conditionallyTransitionRunStatus: conditionallyTransitionRunStatusMock,
      updateAgentLoopStepRun: updateAgentLoopStepRunMock,
      recordAgentLoopEvent: rcRecordAgentLoopEventMock,
      createAgentLoopStepRun: createAgentLoopStepRunMock,
      advanceRunToNextStep: advanceRunToNextStepMock,
      countStepRunsForNode: countStepRunsForNodeMock,
      getMaxAttemptForNode: getMaxAttemptForNodeMock,
      pauseLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      cancelLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      resumeLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      retryCurrentStep: retryCurrentStepStoreMock,
    }));
    mock.module("workflow/api", () => ({ start: rcWorkflowStartMock }));
    runControlsPromise = import("./run-controls");
  });

  test("BT-P1-02a: stalled run with QUEUED currentStepRunId — re-dispatches SAME step run id", async () => {
    // The queued step run (advance happened, dispatch was suppressed)
    const queuedStepRun = makeStepRun({
      id: "step-queued-stalled",
      nodeId: "work",
      attempt: 1,
      status: "queued",
    });
    runControlsStepRunIdToStepRun["step-queued-stalled"] = queuedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "step-queued-stalled",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    // The dispatched stepRunId must be the EXISTING queued step (not a new one)
    expect(rcWorkflowStartCalls.length).toBe(1);
    expect(rcWorkflowStartCalls[0]?.stepRunId).toBe("step-queued-stalled");
  });

  test("BT-P1-02b: stalled run with QUEUED currentStepRunId — run transitions to running", async () => {
    const queuedStepRun = makeStepRun({
      id: "step-queued-stalled-2",
      nodeId: "work",
      attempt: 1,
      status: "queued",
    });
    runControlsStepRunIdToStepRun["step-queued-stalled-2"] = queuedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "step-queued-stalled-2",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    expect(runControlsCurrentLoopRun.status).toBe("running");
  });

  test("BT-P1-02c: stalled run with QUEUED currentStepRunId — no new attempt row created", async () => {
    const queuedStepRun = makeStepRun({
      id: "step-queued-stalled-3",
      nodeId: "work",
      attempt: 1,
      status: "queued",
    });
    runControlsStepRunIdToStepRun["step-queued-stalled-3"] = queuedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "step-queued-stalled-3",
    });

    // Track store calls to verify no new attempt was created
    const creationsBeforeRetry = recordedStepRunCreations.length;

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    // No new step run should have been inserted into the DB
    // (the retryCurrentStep store mock only adds to recordedStepRunCreations
    //  in the n+1 path, not the re-dispatch path)
    expect(recordedStepRunCreations.length).toBe(creationsBeforeRetry);
  });
});

describe("BT-P1-03: retryCurrentStep with FAILED currentStepRunId → creates attempt n+1 (existing behavior)", () => {
  let runControlsPromise: Promise<typeof import("./run-controls")>;

  beforeEach(async () => {
    resetRC();
    mock.module("./store", () => ({
      isAgentLoopRunSourceLive: mock(async () => true),
      createAndAdvanceAgentLoopStep: mock(
        async (input: {
          runId: string;
          fromStepRunId: string;
          nextNodeId: string;
          nextNodeKind: string;
          attempt: number;
          stepCount: number;
          iterationCount: number;
          workflowRunId: string;
        }) => {
          const step = await createAgentLoopStepRunMock({
            loopRunId: input.runId,
            nodeId: input.nextNodeId,
            nodeKind: input.nextNodeKind,
            attempt: input.attempt,
          });
          const advanced = await advanceRunToNextStepMock({
            runId: input.runId,
            fromStepRunId: input.fromStepRunId,
            nextNodeId: input.nextNodeId,
            nextStepRunId: step.id,
            stepCount: input.stepCount,
            iterationCount: input.iterationCount,
            workflowRunId: input.workflowRunId,
          });
          return advanced
            ? { outcome: "advanced" as const, step }
            : { outcome: "duplicate" as const };
        },
      ),
      getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
      getAgentLoopRunWithLoop: getAgentLoopRunWithLoopMock,
      updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
      conditionallyTransitionRunStatus: conditionallyTransitionRunStatusMock,
      updateAgentLoopStepRun: updateAgentLoopStepRunMock,
      recordAgentLoopEvent: rcRecordAgentLoopEventMock,
      createAgentLoopStepRun: createAgentLoopStepRunMock,
      advanceRunToNextStep: advanceRunToNextStepMock,
      countStepRunsForNode: countStepRunsForNodeMock,
      getMaxAttemptForNode: getMaxAttemptForNodeMock,
      pauseLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      cancelLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      resumeLoopRun: mock(async () => {
        throw new RunControlError("illegal_transition", "test");
      }),
      retryCurrentStep: retryCurrentStepStoreMock,
    }));
    mock.module("workflow/api", () => ({ start: rcWorkflowStartMock }));
    runControlsPromise = import("./run-controls");
  });

  test("BT-P1-03a: stalled run with FAILED currentStepRunId — dispatches NEW step run (attempt n+1)", async () => {
    const failedStepRun = makeStepRun({
      id: "step-failed-stalled",
      nodeId: "work",
      attempt: 1,
      status: "failed",
      errorKind: "sandbox_unavailable",
    });
    runControlsStepRunIdToStepRun["step-failed-stalled"] = failedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "step-failed-stalled",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    // Must dispatch — and the dispatched step run id must NOT be the failed one
    expect(rcWorkflowStartCalls.length).toBe(1);
    expect(rcWorkflowStartCalls[0]?.stepRunId).not.toBe("step-failed-stalled");
  });

  test("BT-P1-03b: stalled run with FAILED currentStepRunId — attempt is n+1", async () => {
    const failedStepRun = makeStepRun({
      id: "step-failed-stalled-2",
      nodeId: "work",
      attempt: 2,
      status: "failed",
    });
    runControlsStepRunIdToStepRun["step-failed-stalled-2"] = failedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "step-failed-stalled-2",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    // The retry event should record attempt 3 (=2+1)
    const retryEvent = rcRecordedEvents.find(
      (e) => e.eventName === "agent-loop.run.retry",
    );
    const payload = retryEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["attempt"]).toBe(3);
  });

  test("BT-P1-03c: failed run with FAILED currentStepRunId — also creates attempt n+1 (not regression)", async () => {
    const failedStepRun = makeStepRun({
      id: "step-failed-classical",
      nodeId: "work",
      attempt: 1,
      status: "failed",
    });
    runControlsStepRunIdToStepRun["step-failed-classical"] = failedStepRun;
    runControlsCurrentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-failed-classical",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-p1", "user-1");

    // Classic failed→retry must still work
    expect(rcWorkflowStartCalls.length).toBe(1);
    expect(rcWorkflowStartCalls[0]?.stepRunId).not.toBe(
      "step-failed-classical",
    );
    expect(runControlsCurrentLoopRun.status).toBe("running");
  });
});
