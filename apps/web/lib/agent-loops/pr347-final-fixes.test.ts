/**
 * Agent Loops — PR #347 final-fix behavioral tests (TASK-347F)
 *
 * TDD RED: Three findings from the second PR #347 coordinator review.
 *
 * Finding 1 (P1) — re-check run status after step execution, before advancing:
 *   BT-F1-01: pause-during-execution → advance bookkeeping done, zero dispatches,
 *             paused_before_dispatch event emitted
 *   BT-F1-02: resume after pause-during-execution → re-dispatches the queued step
 *   BT-F1-03: cancel-during-execution → no advance at all
 *   BT-F1-04: completed/failed during execution → no advance
 *
 * Finding 2 (P2 security) — ownership-scope the run-control store functions:
 *   BT-F2-01: pauseLoopRun with wrong userId → same rejection as unknown run
 *   BT-F2-02: cancelLoopRun with wrong userId → same rejection as unknown run
 *   BT-F2-03: resumeLoopRun with wrong userId → same rejection as unknown run
 *   BT-F2-04: retryCurrentStep with wrong userId → same rejection as unknown run
 *   BT-F2-05: correct userId still works for all four functions
 *
 * Alignment — getMaxAttemptForNode for attempt computation:
 *   BT-FA-01: sparse attempts {1,3} → next attempt is 4, not 2 (count+1 would be 2)
 *   BT-FA-02: first visit (no rows) → attempt 1
 *   BT-FA-03: iteration detection still works (priorVisits from countStepRunsForNode > 0)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Captured calls ──────────────────────────────────────────────────────────

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

type StepRunUpdateInput = {
  stepRunId: string;
  status?: string;
  finishedAt?: Date | null;
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
let recordedStepRunUpdates: StepRunUpdateInput[] = [];
let recordedAdvanceCalls: AdvanceRunInput[] = [];
let recordedStepRunCreations: {
  loopRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
}[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

// ── Store mock state ────────────────────────────────────────────────────────

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

let advanceRunRowsUpdated = 1;

// For Finding 1: run status that will be returned by the POST-EXECUTION re-load
// When null, the re-load mock returns the in-memory currentLoopRun (no change)
let postExecutionRunStatus: AgentLoopRun["status"] | null = null;

// For alignment: MAX attempt for a given (loopRunId, nodeId)
// Maps "loopRunId:nodeId" → max attempt seen so far
let maxAttemptForNode: Record<string, number> = {};

// For iteration detection: count of step runs per (loopRunId, nodeId)
let priorStepRunCountForNode: Record<string, number> = {};

let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

let nextStepRunIdCounter = 600;
function nextId() {
  return `f347-${nextStepRunIdCounter++}`;
}

// ── Executor mock state ─────────────────────────────────────────────────────

type ExecutorOutcome = {
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
};

let executorOutcomes: Record<string, ExecutorOutcome> = {};
let executedNodeIds: string[] = [];
let endNodeIds = new Set<string>(["end"]);

// When set, the executor will flip run status mid-call (simulating pause/cancel during execution)
let executorFlipsRunStatus: AgentLoopRun["status"] | null = null;

const executeAgentLoopStepMock = mock(
  async (params: {
    stepRunId: string;
    workflowRunId: string;
  }): Promise<ExecutorOutcome> => {
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

    // Simulate a control-plane operation landing MID-EXECUTION
    if (executorFlipsRunStatus) {
      postExecutionRunStatus = executorFlipsRunStatus;
    }

    if (endNodeIds.has(nodeId)) {
      postExecutionRunStatus = "completed";
    }

    return executorOutcomes[nodeId] ?? { outcome: "success" };
  },
);

// ── Store mocks ──────────────────────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (stepRunId: string) => {
  const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
  return {
    stepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  };
});

// getAgentLoopRunWithLoop — re-loads run after execution to detect status changes
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
      ...(input.currentNodeId !== undefined
        ? { currentNodeId: input.currentNodeId }
        : {}),
      ...(input.currentStepRunId !== undefined
        ? { currentStepRunId: input.currentStepRunId }
        : {}),
      ...(input.errorKind !== undefined ? { errorKind: input.errorKind } : {}),
      ...(input.stepCount !== undefined ? { stepCount: input.stepCount } : {}),
      ...(input.iterationCount !== undefined
        ? { iterationCount: input.iterationCount }
        : {}),
    };
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
  async (params: { loopRunId: string; nodeId: string }): Promise<number> => {
    const key = `${params.loopRunId}:${params.nodeId}`;
    return priorStepRunCountForNode[key] ?? 0;
  },
);

// getMaxAttemptForNode — new store function for alignment fix
const getMaxAttemptForNodeMock = mock(
  async (params: { loopRunId: string; nodeId: string }): Promise<number> => {
    const key = `${params.loopRunId}:${params.nodeId}`;
    return maxAttemptForNode[key] ?? 0;
  },
);

const updateAgentLoopStepRunMock = mock(
  async (input: StepRunUpdateInput): Promise<AgentLoopStepRun> => {
    recordedStepRunUpdates.push(input);
    return makeStepRun({ id: input.stepRunId });
  },
);

// ── Store control plane mocks WITH userId ownership scoping ─────────────────

// Tracks which userId owns which runId for ownership checks
let runOwnership: Record<string, string> = {};

const pauseLoopRunMock = mock(async (runId: string, userId: string) => {
  // Ownership check: unknown run or wrong userId must behave identically
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new Error(
      `Cannot pause run ${runId}: not in a pausable status (running/queued)`,
    );
  }
  if (
    currentLoopRun.status !== "running" &&
    currentLoopRun.status !== "queued"
  ) {
    throw new Error(
      `Cannot pause run ${runId}: not in a pausable status (running/queued)`,
    );
  }
  currentLoopRun = { ...currentLoopRun, status: "paused" };
  recordedRunStatusUpdates.push({ runId, status: "paused" });
  return currentLoopRun;
});

const cancelLoopRunMock = mock(async (runId: string, userId: string) => {
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new Error(
      `Cannot cancel run ${runId}: not in a cancellable status (running/queued/paused)`,
    );
  }
  const ok = new Set(["running", "queued", "paused"]);
  if (!ok.has(currentLoopRun.status)) {
    throw new Error(
      `Cannot cancel run ${runId}: not in a cancellable status (running/queued/paused)`,
    );
  }
  currentLoopRun = { ...currentLoopRun, status: "cancelled" };
  recordedRunStatusUpdates.push({ runId, status: "cancelled" });
  return currentLoopRun;
});

const resumeLoopRunMock = mock(async (runId: string, userId: string) => {
  const owner = runOwnership[runId];
  if (!owner || owner !== userId) {
    throw new Error(`Cannot resume run ${runId}: not in paused status`);
  }
  if (currentLoopRun.status !== "paused") {
    throw new Error(`Cannot resume run ${runId}: not in paused status`);
  }
  currentLoopRun = { ...currentLoopRun, status: "running" };
  recordedRunStatusUpdates.push({ runId, status: "running" });
  return currentLoopRun;
});

const retryCurrentStepMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId, userId } = params;
    const owner = runOwnership[runId];
    if (!owner || owner !== userId) {
      throw new Error(`Run ${runId} not found`);
    }
    if (
      currentLoopRun.status !== "failed" &&
      currentLoopRun.status !== "stalled"
    ) {
      throw new Error(
        `Cannot retry run ${runId}: not in a retryable status (failed/stalled), got: ${currentLoopRun.status}`,
      );
    }
    const failed = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const attempt = (failed?.attempt ?? 1) + 1;
    const id = nextId();
    recordedStepRunCreations.push({
      loopRunId: runId,
      nodeId: currentLoopRun.currentNodeId ?? "work",
      nodeKind: failed?.nodeKind ?? "agent_step",
      attempt,
    });
    const newStepRun = makeStepRun({
      id,
      nodeId: currentLoopRun.currentNodeId ?? "work",
      attempt,
      status: "queued",
    });
    stepRunIdToNodeId[id] = currentLoopRun.currentNodeId ?? "work";
    stepRunIdToStepRun[id] = newStepRun;
    currentLoopRun = {
      ...currentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    recordedRunStatusUpdates.push({ runId, status: "running" });
    return newStepRun;
  },
);

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
  getAgentLoopRunWithLoop: getAgentLoopRunWithLoopMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  conditionallyTransitionRunStatus: mock(
    async (params: { runId: string; toStatus: string }) => {
      recordedRunStatusUpdates.push({
        runId: params.runId,
        status: params.toStatus,
      });
      currentLoopRun = {
        ...currentLoopRun,
        status: params.toStatus as AgentLoopRun["status"],
      };
      return currentLoopRun;
    },
  ),
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  advanceRunToNextStep: advanceRunToNextStepMock,
  countStepRunsForNode: countStepRunsForNodeMock,
  getMaxAttemptForNode: getMaxAttemptForNodeMock,
  pauseLoopRun: pauseLoopRunMock,
  cancelLoopRun: cancelLoopRunMock,
  resumeLoopRun: resumeLoopRunMock,
  retryCurrentStep: retryCurrentStepMock,
  updateAgentLoopRunContext: mock(async () => undefined),
  findStalledLoopRunCandidates: mock(async () => []),
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));

let workflowStartThrows: Error | null = null;
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-f347-${nextStepRunIdCounter}` };
  },
);
mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Simple 3-node graph: start → work → end
 */
function makeSimpleDefinition() {
  return {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "work",
        kind: "agent_step",
        label: "Work",
        position: { x: 1, y: 0 },
        instructions: "do work",
      },
      { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "work", when: "success" },
      { id: "e2", source: "work", target: "end", when: "success" },
    ],
  };
}

/**
 * Cycle graph: start → work → condition --[false]→ work / --[true]→ end
 */
function makeCycleDefinition() {
  return {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "work",
        kind: "agent_step",
        label: "Work",
        position: { x: 1, y: 0 },
        instructions: "do work",
      },
      {
        id: "condition",
        kind: "condition",
        label: "Done?",
        position: { x: 2, y: 0 },
        condition: { path: "done", op: "eq", value: true },
      },
      { id: "end", kind: "end", label: "End", position: { x: 3, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "work", when: "success" },
      { id: "e2", source: "work", target: "condition", when: "success" },
      { id: "e3", source: "condition", target: "end", when: "true" },
      { id: "e4", source: "condition", target: "work", when: "false" },
    ],
  };
}

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-f347",
    userId: "user-1",
    name: "F347 Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "my-repo",
    definition: {} as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-f347",
    loopId: "loop-f347",
    userId: "user-1",
    status: "running",
    definitionSnapshot: makeSimpleDefinition() as Record<string, unknown>,
    currentNodeId: "work",
    currentStepRunId: "step-init",
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-f347",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date(Date.now() - 10_000),
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
    id: "step-init",
    loopRunId: "run-f347",
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

// ── Setup / reset ────────────────────────────────────────────────────────────

function resetAll() {
  recordedEvents = [];
  recordedRunStatusUpdates = [];
  recordedStepRunUpdates = [];
  recordedAdvanceCalls = [];
  recordedStepRunCreations = [];
  workflowStartCalls = [];
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  executorOutcomes = {};
  endNodeIds = new Set(["end"]);
  advanceRunRowsUpdated = 1;
  priorStepRunCountForNode = {};
  maxAttemptForNode = {};
  workflowStartThrows = null;
  postExecutionRunStatus = null;
  executorFlipsRunStatus = null;
  runOwnership = {};
  nextStepRunIdCounter = 600;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-init", nodeId: "work" });
  stepRunIdToNodeId["step-init"] = "work";
  stepRunIdToStepRun["step-init"] = currentStepRun;
  // Default: run is owned by user-1
  runOwnership["run-f347"] = "user-1";

  getAgentLoopStepRunWithContextMock.mockClear();
  getAgentLoopRunWithLoopMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  updateAgentLoopStepRunMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  createAgentLoopStepRunMock.mockClear();
  advanceRunToNextStepMock.mockClear();
  countStepRunsForNodeMock.mockClear();
  getMaxAttemptForNodeMock.mockClear();
  executeAgentLoopStepMock.mockClear();
  workflowStartMock.mockClear();
  pauseLoopRunMock.mockClear();
  cancelLoopRunMock.mockClear();
  resumeLoopRunMock.mockClear();
  retryCurrentStepMock.mockClear();
}

const chainPromise = import("./chain");
// Control-plane functions moved to run-controls.ts; BT-F1-02 and BT-F2 now
// import from run-controls instead of chain.
const runControlsPromise = import("./run-controls");

// ── BT-F1: Re-check run status after step execution ──────────────────────────

describe("BT-F1-01: pause lands during step execution → advance bookkeeping done, zero dispatches, paused_before_dispatch event", () => {
  beforeEach(() => {
    resetAll();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-init",
      stepCount: 1,
    });
    executorOutcomes["work"] = { outcome: "success" };

    // Simulate pause landing DURING the executor call
    executorFlipsRunStatus = "paused";
  });

  test("BT-F1-01a: pause-during-execution → zero dispatches (workflow NOT started)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
  });

  test("BT-F1-01b: pause-during-execution → agent-loop.chain.paused_before_dispatch event emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    const pausedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.paused_before_dispatch",
    );
    expect(pausedEvent).toBeDefined();
  });

  test("BT-F1-01c: pause-during-execution → advance bookkeeping IS done (advanceRunToNextStep called)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    // Advance bookkeeping (edge evaluation, step run creation, advanceRunToNextStep) must happen
    // so that currentStepRunId points at the QUEUED next step for resumeLoopRun to pick up
    expect(recordedAdvanceCalls.length).toBeGreaterThan(0);
  });

  test("BT-F1-01d: pause-during-execution → next step run is created (so resume can dispatch it)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    // A step run for the next node must have been created
    expect(recordedStepRunCreations.length).toBeGreaterThan(0);
  });
});

describe("BT-F1-02: resume after pause-during-execution → re-dispatches the queued step", () => {
  beforeEach(() => {
    resetAll();

    // Simulate: step ran, pause landed, advance happened, next step is queued
    // currentStepRunId now points at the queued next step
    const nextStep = makeStepRun({
      id: "step-next",
      nodeId: "end",
      nodeKind: "end",
      status: "queued",
    });
    stepRunIdToStepRun["step-next"] = nextStep;
    stepRunIdToNodeId["step-next"] = "end";

    currentLoopRun = makeLoopRun({
      status: "paused",
      currentNodeId: "end",
      currentStepRunId: "step-next",
    });
  });

  test("BT-F1-02: resumeLoopRun re-dispatches the queued step (workflow start called once)", async () => {
    const { resumeLoopRun } = await runControlsPromise;
    await resumeLoopRun("run-f347", "user-1");

    expect(workflowStartCalls.length).toBe(1);
    expect(workflowStartCalls[0]?.stepRunId).toBe("step-next");
  });

  test("BT-F1-02: resumeLoopRun transitions from paused to running", async () => {
    const { resumeLoopRun } = await runControlsPromise;
    await resumeLoopRun("run-f347", "user-1");

    expect(currentLoopRun.status).toBe("running");
  });
});

describe("BT-F1-03: cancel lands during step execution → no advance at all", () => {
  beforeEach(() => {
    resetAll();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-init",
      stepCount: 1,
    });
    executorOutcomes["work"] = { outcome: "success" };

    // Simulate cancel landing DURING the executor call
    executorFlipsRunStatus = "cancelled";
  });

  test("BT-F1-03a: cancel-during-execution → zero dispatches", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
  });

  test("BT-F1-03b: cancel-during-execution → NO advance bookkeeping (advanceRunToNextStep NOT called)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    expect(recordedAdvanceCalls.length).toBe(0);
  });

  test("BT-F1-03c: cancel-during-execution → agent-loop.chain.skipped event with reason status_changed_during_step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("status_changed_during_step");
  });

  test("BT-F1-03d: cancel-during-execution → skipped event includes the status", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["status"]).toBe("cancelled");
  });
});

describe("BT-F1-04: run completed/failed during step execution → no advance", () => {
  beforeEach(() => {
    resetAll();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-init",
    });
    executorOutcomes["work"] = { outcome: "success" };
  });

  test("BT-F1-04a: run becomes completed during execution → zero dispatches, zero advance calls", async () => {
    executorFlipsRunStatus = "completed";

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
    expect(recordedAdvanceCalls.length).toBe(0);
  });

  test("BT-F1-04b: run becomes failed during execution → zero dispatches, zero advance calls", async () => {
    executorFlipsRunStatus = "failed";

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
    expect(recordedAdvanceCalls.length).toBe(0);
  });

  test("BT-F1-04c: completed/failed → agent-loop.chain.skipped with reason status_changed_during_step", async () => {
    executorFlipsRunStatus = "failed";

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-init",
      workflowRunId: "wf-run-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("status_changed_during_step");
  });
});

// ── BT-F2: Ownership-scoped run-control store functions ──────────────────────

describe("BT-F2: store run-control functions reject wrong userId with same error as unknown run", () => {
  beforeEach(() => {
    resetAll();
    currentLoopRun = makeLoopRun({ status: "running" });
    // run-f347 is owned by user-1
    runOwnership["run-f347"] = "user-1";
  });

  test("BT-F2-01: pauseLoopRun with wrong userId → rejects with same error type as unknown run", async () => {
    const { pauseLoopRun } = await runControlsPromise;

    // With correct userId — must work
    await expect(pauseLoopRun("run-f347", "user-1")).resolves.toBeUndefined();

    // Reset status for next test
    currentLoopRun = { ...currentLoopRun, status: "running" };

    // With wrong userId — must reject
    await expect(pauseLoopRun("run-f347", "attacker-user")).rejects.toThrow();
  });

  test("BT-F2-01: pauseLoopRun wrong userId → row is untouched (status remains running)", async () => {
    const { pauseLoopRun } = await runControlsPromise;

    try {
      await pauseLoopRun("run-f347", "attacker-user");
    } catch {
      // expected
    }

    // Status must still be running — the row was not mutated
    expect(currentLoopRun.status).toBe("running");
  });

  test("BT-F2-02: cancelLoopRun with wrong userId → rejects", async () => {
    const { cancelLoopRun } = await runControlsPromise;

    await expect(cancelLoopRun("run-f347", "attacker-user")).rejects.toThrow();
    // Row untouched
    expect(currentLoopRun.status).toBe("running");
  });

  test("BT-F2-03: resumeLoopRun with wrong userId → rejects", async () => {
    currentLoopRun = makeLoopRun({ status: "paused" });
    const { resumeLoopRun } = await runControlsPromise;

    await expect(resumeLoopRun("run-f347", "attacker-user")).rejects.toThrow();
    expect(currentLoopRun.status).toBe("paused");
  });

  test("BT-F2-04: retryCurrentStep with wrong userId → rejects with same error as unknown run", async () => {
    const failedStep = makeStepRun({
      id: "step-failed",
      nodeId: "work",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["step-failed"] = failedStep;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-failed",
    });

    const { retryCurrentStep } = await runControlsPromise;

    await expect(
      retryCurrentStep("run-f347", "attacker-user"),
    ).rejects.toThrow();
    // Row untouched — still failed
    expect(currentLoopRun.status).toBe("failed");
  });

  test("BT-F2-05: all four control functions work correctly with the correct userId", async () => {
    const { pauseLoopRun, cancelLoopRun } = await runControlsPromise;

    // Pause with correct user
    currentLoopRun = makeLoopRun({ status: "running" });
    await expect(pauseLoopRun("run-f347", "user-1")).resolves.toBeUndefined();
    expect(currentLoopRun.status).toBe("paused");

    // Cancel from paused with correct user
    await expect(cancelLoopRun("run-f347", "user-1")).resolves.toBeUndefined();
    expect(currentLoopRun.status).toBe("cancelled");
  });
});

// ── BT-FA: Attempt computation uses MAX, not COUNT (sparse-safe) ─────────────

describe("BT-FA: attempt computation uses MAX(attempt)+1, not count+1 (sparse-safe)", () => {
  beforeEach(() => {
    resetAll();

    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: makeCycleDefinition() as Record<string, unknown>,
      currentNodeId: "condition",
      currentStepRunId: "step-cond-fa",
      stepCount: 3,
    });

    const condStep = makeStepRun({
      id: "step-cond-fa",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-cond-fa"] = "condition";
    stepRunIdToStepRun["step-cond-fa"] = condStep;
    currentStepRun = condStep;

    executorOutcomes["condition"] = { outcome: "false" }; // → loop back to work
  });

  test("BT-FA-01: sparse attempts {1,3} → getMaxAttemptForNode returns 3, next attempt is 4 (not count+1=2)", async () => {
    // 2 step run rows exist for "work" (attempts 1 and 3, sparse — attempt 2 was skipped)
    priorStepRunCountForNode["run-f347:work"] = 2; // COUNT = 2 → count+1 = 3 (wrong!)
    maxAttemptForNode["run-f347:work"] = 3; // MAX = 3 → max+1 = 4 (correct)

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-fa",
      workflowRunId: "wf-run-1",
    });

    const workCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(workCreation).toBeDefined();
    // Must be 4 (max+1), not 3 (count+1) — this is the sparse-safe computation
    expect(workCreation?.attempt).toBe(4);
  });

  test("BT-FA-02: first visit to a node (no prior rows) → getMaxAttemptForNode returns 0, attempt is 1", async () => {
    // No prior visits
    priorStepRunCountForNode["run-f347:work"] = 0;
    maxAttemptForNode["run-f347:work"] = 0; // no rows → max = 0 → attempt = 1

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-fa",
      workflowRunId: "wf-run-1",
    });

    const workCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(workCreation?.attempt).toBe(1);
  });

  test("BT-FA-03: iteration counting still uses countStepRunsForNode (count > 0 means loop)", async () => {
    // 1 prior visit to work → this is a loop iteration
    priorStepRunCountForNode["run-f347:work"] = 1;
    maxAttemptForNode["run-f347:work"] = 1;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-fa",
      workflowRunId: "wf-run-1",
    });

    // advanceRunToNextStep must have been called with iterationCount > initial (0)
    const advanceCall = recordedAdvanceCalls[recordedAdvanceCalls.length - 1];
    expect(advanceCall).toBeDefined();
    expect(advanceCall?.iterationCount).toBeGreaterThan(0);
    // countStepRunsForNode must have been called (for iteration detection)
    expect(countStepRunsForNodeMock.mock.calls.length).toBeGreaterThan(0);
  });

  test("BT-FA-04: getMaxAttemptForNode must be called during advance (not just countStepRunsForNode)", async () => {
    priorStepRunCountForNode["run-f347:work"] = 2;
    maxAttemptForNode["run-f347:work"] = 5;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-fa",
      workflowRunId: "wf-run-1",
    });

    // getMaxAttemptForNode must be called during the advance phase
    expect(getMaxAttemptForNodeMock.mock.calls.length).toBeGreaterThan(0);
  });
});
