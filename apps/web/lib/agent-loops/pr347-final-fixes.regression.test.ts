/**
 * Agent Loops — PR #347 final-fix regression tests (TASK-347F)
 *
 * These tests catch future regressions if the changes in the green commit are reverted.
 * Each tests a different angle than the behavioral tests — edge cases and integration points.
 *
 * REG-F1: pause-during-execution advance semantics are durable
 *   REG-F1-01: running step with pause → BOTH advance AND paused_before_dispatch (no dispatch)
 *   REG-F1-02: cancel-during-execution skips even when executor returns "success"
 *   REG-F1-03: failed run during execution does not trigger double-advance
 *
 * REG-F2: ownership scoping cannot be bypassed
 *   REG-F2-01: different userId for same runId always rejects (multiple calls, always rejected)
 *   REG-F2-02: cancel of unowned run leaves the run untouched (idempotent rejection)
 *
 * REG-FA: MAX-based attempt never aliases with COUNT
 *   REG-FA-01: when count and max diverge, max wins for attempt assignment
 *   REG-FA-02: iteration counting mock calls — countStepRunsForNode still called for iteration
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

// Post-execution status: when set, getAgentLoopRunWithLoop returns this status
let postExecutionRunStatus: AgentLoopRun["status"] | null = null;

// MAX attempt per (loopRunId, nodeId)
let maxAttemptForNode: Record<string, number> = {};

// COUNT of step runs per (loopRunId, nodeId)
let priorStepRunCountForNode: Record<string, number> = {};

let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

let nextStepRunIdCounter = 800;
function nextId() {
  return `reg-f347-${nextStepRunIdCounter++}`;
}

// ── Executor mock state ─────────────────────────────────────────────────────

type ExecutorOutcome = {
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
};

let executorOutcomes: Record<string, ExecutorOutcome> = {};
let executedNodeIds: string[] = [];
let endNodeIds = new Set<string>(["end"]);
let executorFlipsRunStatus: AgentLoopRun["status"] | null = null;

const executeAgentLoopStepMock = mock(
  async (params: {
    stepRunId: string;
    workflowRunId: string;
  }): Promise<ExecutorOutcome> => {
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

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

let runOwnership: Record<string, string> = {};

const pauseLoopRunMock = mock(async (runId: string, userId: string) => {
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
    return { runId: `wf-reg-f347-${nextStepRunIdCounter}` };
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
    id: "loop-reg-f347",
    userId: "user-1",
    name: "REG F347 Test Loop",
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
    id: "run-reg-f347",
    loopId: "loop-reg-f347",
    userId: "user-1",
    status: "running",
    definitionSnapshot: makeSimpleDefinition() as Record<string, unknown>,
    currentNodeId: "work",
    currentStepRunId: "step-reg-init",
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg-f347",
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
    id: "step-reg-init",
    loopRunId: "run-reg-f347",
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

function reset() {
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
  nextStepRunIdCounter = 800;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-reg-init", nodeId: "work" });
  stepRunIdToNodeId["step-reg-init"] = "work";
  stepRunIdToStepRun["step-reg-init"] = currentStepRun;
  runOwnership["run-reg-f347"] = "user-1";

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
// Control-plane functions moved to run-controls.ts; REG-F2 now imports from run-controls.
const runControlsPromise = import("./run-controls");

// ── REG-F1: Pause-during-execution semantics are durable ────────────────────

describe("REG-F1-01: pause-during-execution: advance + no dispatch together — both invariants hold", () => {
  beforeEach(() => {
    reset();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-reg-init",
      stepCount: 1,
    });
    executorOutcomes["work"] = { outcome: "success" };
    executorFlipsRunStatus = "paused";
  });

  test("REG-F1-01: advance called AND dispatch suppressed in the SAME run (not either/or)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-init",
      workflowRunId: "wf-reg-1",
    });

    // Advance bookkeeping must have run (pointer update for resume)
    expect(recordedAdvanceCalls.length).toBeGreaterThan(0);
    // But dispatch must be suppressed
    expect(workflowStartCalls.length).toBe(0);
    // And the paused_before_dispatch event must be the signal
    const pausedEvt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.paused_before_dispatch",
    );
    expect(pausedEvt).toBeDefined();
  });
});

describe("REG-F1-02: cancel-during-execution: executor returns success but no advance fires", () => {
  beforeEach(() => {
    reset();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-reg-init",
    });
    // Executor returns success — but cancel landed
    executorOutcomes["work"] = { outcome: "success" };
    executorFlipsRunStatus = "cancelled";
  });

  test("REG-F1-02: success outcome does not bypass the post-execution status re-check", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-init",
      workflowRunId: "wf-reg-2",
    });

    // Even though executor returned success, cancel must win
    expect(workflowStartCalls.length).toBe(0);
    expect(recordedAdvanceCalls.length).toBe(0);

    // skipped event with correct reason
    const evt = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    const payload = evt?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("status_changed_during_step");
    expect(payload?.["status"]).toBe("cancelled");
  });
});

describe("REG-F1-03: failed-during-execution: no double-advance on post-execution failed status", () => {
  beforeEach(() => {
    reset();

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-reg-init",
    });
    executorOutcomes["work"] = { outcome: "success" };
    executorFlipsRunStatus = "failed";
  });

  test("REG-F1-03: failed run during execution skips advance (no step run created)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-init",
      workflowRunId: "wf-reg-3",
    });

    // No advance call
    expect(recordedAdvanceCalls.length).toBe(0);
    // No new step run
    expect(recordedStepRunCreations.length).toBe(0);
    // No dispatch
    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── REG-F2: Ownership scoping cannot be bypassed ────────────────────────────

describe("REG-F2-01: repeated wrong-userId calls always reject (not just first call)", () => {
  beforeEach(() => {
    reset();
    currentLoopRun = makeLoopRun({ status: "running" });
  });

  test("REG-F2-01: pauseLoopRun rejects on every call with wrong userId, not just the first", async () => {
    const { pauseLoopRun } = await runControlsPromise;

    // Three separate calls with wrong userId — all must reject
    await expect(pauseLoopRun("run-reg-f347", "eve")).rejects.toThrow();
    await expect(pauseLoopRun("run-reg-f347", "mallory")).rejects.toThrow();
    await expect(pauseLoopRun("run-reg-f347", "attacker")).rejects.toThrow();

    // Run still running (none of the bad calls mutated it)
    expect(currentLoopRun.status).toBe("running");
  });
});

describe("REG-F2-02: cancel of unowned run is idempotent rejection (no partial mutation)", () => {
  beforeEach(() => {
    reset();
    currentLoopRun = makeLoopRun({ status: "running" });
  });

  test("REG-F2-02: cancelling unowned run then cancelling owned run: only the second succeeds", async () => {
    const { cancelLoopRun } = await runControlsPromise;

    // Bad actor tries to cancel
    await expect(cancelLoopRun("run-reg-f347", "bad-actor")).rejects.toThrow();
    // Run still running
    expect(currentLoopRun.status).toBe("running");

    // Owner cancels successfully
    await expect(
      cancelLoopRun("run-reg-f347", "user-1"),
    ).resolves.toBeUndefined();
    expect(currentLoopRun.status).toBe("cancelled");
  });
});

// ── REG-FA: MAX-based attempt never aliases with COUNT ──────────────────────

describe("REG-FA-01: when max and count diverge, max wins for attempt assignment", () => {
  beforeEach(() => {
    reset();

    // Cycle graph so we reach the "condition → work" loop-back
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: makeCycleDefinition() as Record<string, unknown>,
      currentNodeId: "condition",
      currentStepRunId: "step-reg-cond",
      stepCount: 4,
    });

    const condStep = makeStepRun({
      id: "step-reg-cond",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-reg-cond"] = "condition";
    stepRunIdToStepRun["step-reg-cond"] = condStep;
    currentStepRun = condStep;

    // Condition routes to work again
    executorOutcomes["condition"] = { outcome: "false" };
  });

  test("REG-FA-01: count=2, max=5 → attempt must be 6 (max+1), not 3 (count+1)", async () => {
    // Divergent: 2 rows exist but max attempt is 5 (sparse gap at 3,4)
    priorStepRunCountForNode["run-reg-f347:work"] = 2;
    maxAttemptForNode["run-reg-f347:work"] = 5;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-cond",
      workflowRunId: "wf-reg-fa",
    });

    const workCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(workCreation).toBeDefined();
    // Must be 6 (5+1), not 3 (2+1)
    expect(workCreation?.attempt).toBe(6);
  });
});

describe("REG-FA-02: countStepRunsForNode is still called for iteration increment", () => {
  beforeEach(() => {
    reset();

    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: makeCycleDefinition() as Record<string, unknown>,
      currentNodeId: "condition",
      currentStepRunId: "step-reg-cond2",
      stepCount: 2,
      iterationCount: 0,
    });

    const condStep = makeStepRun({
      id: "step-reg-cond2",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-reg-cond2"] = "condition";
    stepRunIdToStepRun["step-reg-cond2"] = condStep;
    currentStepRun = condStep;

    executorOutcomes["condition"] = { outcome: "false" };
  });

  test("REG-FA-02: countStepRunsForNode called during advance (iteration detection path)", async () => {
    priorStepRunCountForNode["run-reg-f347:work"] = 1;
    maxAttemptForNode["run-reg-f347:work"] = 1;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-cond2",
      workflowRunId: "wf-reg-fa2",
    });

    // countStepRunsForNode must be called (for iteration detection)
    expect(countStepRunsForNodeMock.mock.calls.length).toBeGreaterThan(0);
    // iterationCount must have been incremented (since priorVisits > 0)
    const advanceCall = recordedAdvanceCalls[recordedAdvanceCalls.length - 1];
    expect(advanceCall?.iterationCount).toBeGreaterThan(0);
  });
});
