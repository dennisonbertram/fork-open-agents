/**
 * Agent Loops — chain.ts tests (M1-06)
 *
 * Full TDD matrix for runAgentLoopStep / advanceLoopRun:
 *
 * BT-C01: Canonical walk — 6-node graph, loop once then end, exact event sequence
 * BT-C02: Failure stop — failed step, no failure edge → run failed, no dispatch
 * BT-C03: Failure routed — failed step WITH failure edge → continues
 * BT-C04: chain_route_missing — dangling/null route on success → run failed, distinct event
 * BT-C05: Guardrail trips — steps, iterations, wall-clock
 * BT-C06: Cooperative — paused/cancelled before execution → skipped, step not executed
 * BT-C07: Cooperative — queued → running transition fires run.started exactly once
 * BT-C08: Double-advance — advance twice for same step → exactly one dispatch
 * BT-C09: Dispatch-throw — start() throws → dispatch_failed event, run recoverable
 * BT-C10: pause/resume/cancel/retry transitions (legal + illegal) — MIGRATED to run-controls.test.ts
 * BT-C11: end node — no edge evaluation, no dispatch after run completion
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import {
  AgentLoopSnapshotError,
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
  toAgentLoopExecutionPolicy,
} from "./execution-snapshot";

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
let atomicAdvanceSourceDeleted = false;
let sourceLiveBeforeDispatch = true;
let contextLoadError: Error | null = null;

// ── Store mock state ──────────────────────────────────────────────────────────

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

// Controls what advance returns: 0 = no rows updated (duplicate), 1 = updated
let advanceRunRowsUpdated = 1;

// Controls how many prior step runs exist for a given (loopRunId, nodeId) pair
let priorStepRunCountForNode: Record<string, number> = {};

// Controls next step run ID returned by createAgentLoopStepRun
let nextStepRunIdCounter = 100;
function nextStepRunId() {
  return `step-run-${nextStepRunIdCounter++}`;
}

// ── Executor mock state ───────────────────────────────────────────────────────

type ExecutorOutcome = {
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
  errorMessage?: string;
};

// Maps nodeId → executor outcome for that step
let executorOutcomes: Record<string, ExecutorOutcome> = {};
// Track which nodeIds were executed
let executedNodeIds: string[] = [];
// Whether the executor should simulate an end-node finalizing the run
let endNodeIds = new Set<string>();
let executorThrows: Error | null = null;

const executeAgentLoopStepMock = mock(
  async (params: {
    stepRunId: string;
    workflowRunId: string;
    stepTimeoutMs?: number;
  }): Promise<ExecutorOutcome> => {
    if (executorThrows) {
      throw executorThrows;
    }

    // Find the node by stepRunId (via currentStepRun mapping)
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

    // Simulate end node finalizing the run
    if (endNodeIds.has(nodeId)) {
      currentLoopRun = { ...currentLoopRun, status: "completed" };
      recordedRunStatusUpdates.push({
        runId: currentLoopRun.id,
        status: "completed",
      });
    }

    const result = executorOutcomes[nodeId] ?? { outcome: "success" };
    return result;
  },
);

// Maps stepRunId → nodeId for multi-step scenarios
let stepRunIdToNodeId: Record<string, string> = {};

// ── Store mocks ───────────────────────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (stepRunId: string) => {
  if (contextLoadError) throw contextLoadError;
  // Return context for the given stepRunId
  const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
  return {
    stepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  };
});

describe("execution snapshot fail-closed boundary", () => {
  test("snapshot loader failure uses winner-only CAS and safe terminal evidence", async () => {
    currentLoopRun = makeLoopRun({ status: "queued" });
    currentLoop = makeLoop();
    currentStepRun = makeStepRun();
    contextLoadError = new AgentLoopSnapshotError(
      "snapshot_hash_mismatch",
      "Execution snapshot hash verification failed.",
      currentLoopRun.id,
    );
    try {
      const { runAgentLoopStep } = await chainPromise;
      await runAgentLoopStep({
        stepRunId: currentStepRun.id,
        workflowRunId: "wf-snapshot-invalid",
      });
    } finally {
      contextLoadError = null;
    }

    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledWith({
      runId: currentLoopRun.id,
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "snapshot_hash_mismatch",
      errorMessage: "Execution snapshot hash verification failed.",
    });
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.snapshot.invalid",
        payload: { errorKind: "snapshot_hash_mismatch" },
      }),
    );
    expect(executeAgentLoopStepMock).not.toHaveBeenCalled();
  });

  test("losing the terminal CAS does not contradict a concurrent control action", async () => {
    currentLoopRun = makeLoopRun({ status: "queued" });
    currentLoop = makeLoop();
    currentStepRun = makeStepRun();
    recordedEvents = [];
    updateAgentLoopStepRunMock.mockClear();
    transitionShouldWin = false;
    contextLoadError = new AgentLoopSnapshotError(
      "source_inactive",
      "Source Automation is no longer active.",
      currentLoopRun.id,
    );
    try {
      const { runAgentLoopStep } = await chainPromise;
      await runAgentLoopStep({
        stepRunId: currentStepRun.id,
        workflowRunId: "wf-source-inactive",
      });
    } finally {
      contextLoadError = null;
      transitionShouldWin = true;
    }

    expect(updateAgentLoopStepRunMock).not.toHaveBeenCalled();
    expect(recordedEvents).toHaveLength(0);
    expect(executeAgentLoopStepMock).not.toHaveBeenCalled();
  });
});

// Maps stepRunId → stepRun object
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

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
      ...(input.errorMessage !== undefined
        ? { errorMessage: input.errorMessage }
        : {}),
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
    const id = nextStepRunId();
    recordedStepRunCreations.push({
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt: input.attempt ?? 1,
    });
    const newStepRun: AgentLoopStepRun = makeStepRun({
      id,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt: input.attempt ?? 1,
    });
    stepRunIdToNodeId[id] = input.nodeId;
    stepRunIdToStepRun[id] = newStepRun;
    return newStepRun;
  },
);

const advanceRunToNextStepMock = mock(
  async (input: AdvanceRunInput): Promise<boolean> => {
    recordedAdvanceCalls.push(input);
    if (advanceRunRowsUpdated === 0) {
      return false; // 0 rows updated — duplicate advance
    }
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

const updateAgentLoopStepRunMock = mock(async (_input: unknown) => {
  return currentStepRun;
});

// Note: pause/cancel/resume/retry store mocks are not needed here — those
// control-plane functions have been removed from chain.ts and live exclusively
// in run-controls.ts. Tests for those behaviors are in run-controls.test.ts.

// getAgentLoopRunWithLoop — for post-execution status re-check (Finding 1)
// Returns the current loopRun (no status flip in these tests)
const getAgentLoopRunWithLoopMock = mock(async (_runId: string) => ({
  run: currentLoopRun,
  loop: currentLoop,
}));

// getMaxAttemptForNode — for sparse-safe attempt computation (Alignment)
// Uses priorStepRunCountForNode as a proxy for max attempt (same value in non-sparse tests)
const getMaxAttemptForNodeMock = mock(
  async (params: { loopRunId: string; nodeId: string }): Promise<number> => {
    const key = `${params.loopRunId}:${params.nodeId}`;
    return priorStepRunCountForNode[key] ?? 0;
  },
);

// conditionallyTransitionRunStatus — new in M1-10 race fix.
// Returns the updated run (transition succeeded) by default.
// Tests that need to simulate a race (0 rows) override this mock.
let transitionShouldWin = true;
const conditionallyTransitionRunStatusMock = mock(
  async (params: {
    runId: string;
    toStatus: AgentLoopRun["status"];
    fromStatuses: AgentLoopRun["status"][];
    errorKind?: string | null;
    errorMessage?: string | null;
  }): Promise<AgentLoopRun | null> => {
    if (!transitionShouldWin) return null;
    // Record as a status update so existing assertions still pass
    recordedRunStatusUpdates.push({
      runId: params.runId,
      status: params.toStatus,
      errorKind: params.errorKind,
      errorMessage: params.errorMessage,
    });
    currentLoopRun = {
      ...currentLoopRun,
      status: params.toStatus,
    };
    return currentLoopRun;
  },
);

const isAgentLoopRunSourceLiveMock = mock(
  async (_runId: string) => sourceLiveBeforeDispatch,
);

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: isAgentLoopRunSourceLiveMock,
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
      if (atomicAdvanceSourceDeleted) {
        return { outcome: "source_deleted" as const };
      }
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
  retryCurrentStep: mock(async () => undefined),
  // M3-01 watchdog store stubs (not exercised by chain tests directly)
  createAgentLoopWatchdogRun: mock(async () => ({ id: "wd-run-1" })),
  updateAgentLoopWatchdogRun: mock(async () => undefined),
  countWatchdogRetryDecisions: mock(async () => 0),
  retryCurrentStepForWatchdog: mock(async () => ({
    id: "new-step-1",
    attempt: 2,
    nodeId: "n1",
  })),
  pauseLoopRunSystem: mock(async () => undefined),
  advanceToFailureEdge: mock(async () => true),
  dispatchStepWorkflow: mock(async () => undefined),
  listWatchdogRunsForLoopRun: mock(async () => []),
}));

// M3-01: mock the watchdog module so chain.ts can import it without real DB
const invokeWatchdogMock = mock(async (_params: unknown) => ({
  invoked: true,
  decision: "retry" as const,
}));
mock.module("./watchdog", () => ({
  invokeWatchdog: invokeWatchdogMock,
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));

// workflow/api mock — the house pattern
let workflowStartThrows: Error | null = null;
let workflowRunIdCounter = 200;
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    if (workflowStartThrows) throw workflowStartThrows;
    workflowStartCalls.push(args[0]);
    return { runId: `wf-run-${workflowRunIdCounter++}` };
  },
);
mock.module("workflow/api", () => ({
  start: workflowStartMock,
}));

// Mock the workflow package itself (used by agent-loop-step.ts)
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));

// Mock the workflow file — prevents transitive 'workflow' package import errors.
// chain.ts imports runAgentLoopStepWorkflow only to pass to start() as a reference.
// Since start() itself is mocked, the actual implementation is never called here.
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Canonical 6-node graph:
 * start → github_check → condition → agent_step → end
 * condition (false) → github_check (loop back)
 */
function makeCanonicalDefinition() {
  return {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "github_check",
        kind: "github_check",
        label: "Check Issues",
        position: { x: 1, y: 0 },
        check: { kind: "list_issues" },
      },
      {
        id: "condition",
        kind: "condition",
        label: "Has Issues?",
        position: { x: 2, y: 0 },
        condition: { path: "github_check.openIssueCount", op: "gt", value: 0 },
      },
      {
        id: "agent_step",
        kind: "agent_step",
        label: "Implement",
        position: { x: 3, y: 0 },
        instructions: "Do the work",
      },
      { id: "end", kind: "end", label: "End", position: { x: 4, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "github_check", when: "success" },
      {
        id: "e2",
        source: "github_check",
        target: "condition",
        when: "success",
      },
      { id: "e3", source: "condition", target: "agent_step", when: "true" },
      { id: "e4", source: "condition", target: "github_check", when: "false" }, // loop back
      { id: "e5", source: "agent_step", target: "end", when: "success" },
    ],
  };
}

function makeLoop(
  overrides: Partial<
    AgentLoop & {
      watchdogEnabled?: boolean;
      watchdogInstructions?: string | null;
      watchdogRetryBudget?: number;
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
    // M3-01 watchdog fields — disabled by default so existing tests are unchanged
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
    status: "queued",
    definitionSnapshot: makeCanonicalDefinition() as Record<string, unknown>,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: "start",
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: null,
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
    id: "step-run-1",
    loopRunId: "loop-run-1",
    nodeId: "start",
    nodeKind: "start",
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
  atomicAdvanceSourceDeleted = false;
  sourceLiveBeforeDispatch = true;
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  executorOutcomes = {};
  endNodeIds = new Set(["end"]);
  executorThrows = null;
  advanceRunRowsUpdated = 1;
  priorStepRunCountForNode = {};
  workflowStartThrows = null;
  nextStepRunIdCounter = 100;
  workflowRunIdCounter = 200;
  transitionShouldWin = true;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
  stepRunIdToNodeId["step-run-1"] = "start";
  stepRunIdToStepRun["step-run-1"] = currentStepRun;

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
  isAgentLoopRunSourceLiveMock.mockClear();
  invokeWatchdogMock.mockClear();
}

// Import chain after all mocks are set up
const chainPromise = import("./chain");

// ── BT-C01: Canonical walk ────────────────────────────────────────────────────

describe("BT-C01: canonical walk — start → github_check (false) → github_check (loop) → agent_step → end", () => {
  beforeEach(() => {
    resetAll();

    // Set up outcomes: start succeeds, github_check succeeds (goes to condition),
    // condition is false first time (loops back to github_check),
    // condition is true second time (goes to agent_step),
    // agent_step succeeds (goes to end), end completes
    executorOutcomes = {
      start: { outcome: "success" },
      github_check: { outcome: "success" },
      condition: { outcome: "false" }, // first time: false → loop back
      agent_step: { outcome: "success" },
      end: { outcome: "success" },
    };

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
    stepRunIdToNodeId["step-run-1"] = "start";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "queued",
      currentNodeId: "start",
      currentStepRunId: "step-run-1",
    });
  });

  test("BT-C01: run transitions queued → running on first step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    // Should have transitioned to running
    const runningUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "running",
    );
    expect(runningUpdate).toBeDefined();
  });

  test("BT-C01: agent-loop.run.started emitted exactly once for first step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const startedEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(startedEvents.length).toBe(1);
  });

  test("BT-C01: start node — executor called, dispatch fired, agent-loop.edge.evaluated emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    // Executor must have been called with the start step run
    expect(executedNodeIds).toContain("start");

    // An edge evaluated event should have been emitted
    const edgeEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.edge.evaluated",
    );
    expect(edgeEvent).toBeDefined();

    // Workflow should have been dispatched for next step
    expect(workflowStartCalls.length).toBe(1);

    // A chain dispatched event should have been emitted
    const dispatchedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatched",
    );
    expect(dispatchedEvent).toBeDefined();
  });

  test("BT-C01: when condition loops back, iterationCount increments", async () => {
    // Set up: start step executed, we're now on condition (false → github_check loop)
    // Simulate a prior step run exists for github_check (making it a loop)
    priorStepRunCountForNode["loop-run-1:github_check"] = 1;

    const conditionStepRun = makeStepRun({
      id: "step-run-cond",
      nodeId: "condition",
    });
    stepRunIdToNodeId["step-run-cond"] = "condition";
    stepRunIdToStepRun["step-run-cond"] = conditionStepRun;
    currentStepRun = conditionStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-run-cond",
      stepCount: 2, // start + github_check already executed
    });

    executorOutcomes["condition"] = { outcome: "false" }; // false → github_check loop

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-cond",
      workflowRunId: "wf-run-2",
    });

    // advance call should have iterationCount = 1
    const advanceCall = recordedAdvanceCalls[recordedAdvanceCalls.length - 1];
    expect(advanceCall).toBeDefined();
    expect(advanceCall?.iterationCount).toBeGreaterThan(0);
  });
});

// ── BT-C02: Failure stop — no failure edge ───────────────────────────────────

describe("BT-C02: failure stop — failed step, no failure edge → run failed", () => {
  beforeEach(() => {
    resetAll();

    // Use a simple graph with no failure edges
    const definition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
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
        // No failure edge from work
      ],
    };

    const workStepRun = makeStepRun({ id: "step-work-1", nodeId: "work" });
    stepRunIdToNodeId["step-work-1"] = "work";
    stepRunIdToStepRun["step-work-1"] = workStepRun;
    currentStepRun = workStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: definition as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-work-1",
    });
    currentLoop = makeLoop();

    executorOutcomes["work"] = {
      outcome: "failure",
      errorKind: "sandbox_unavailable",
      errorMessage: "Sandbox failed",
    };
  });

  test("BT-C02: run fails with step errorKind when no failure edge exists", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-1",
      workflowRunId: "wf-run-1",
    });

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("sandbox_unavailable");
  });

  test("BT-C02: zero dispatches when failure has no edge", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-1",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
  });

  test("BT-C02: default sink surfaces the underlying step error message (not a masking 'no failure edge' string)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-1",
      workflowRunId: "wf-run-1",
    });

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    // The real diagnostic from the step must reach the run level, otherwise the
    // run shows an unhelpful "no failure edge" message and hides the cause.
    expect(failedUpdate?.errorMessage).toBe("Sandbox failed");
  });

  test("BT-C02: run.failed event marks the unhandled failure as routed to the default sink", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-1",
      workflowRunId: "wf-run-1",
    });

    const failedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.failed",
    );
    expect(failedEvent).toBeDefined();
    const payload = failedEvent?.payload as
      | { routedToDefaultSink?: boolean; nodeId?: string }
      | undefined;
    expect(payload?.routedToDefaultSink).toBe(true);
    expect(payload?.nodeId).toBe("work");
  });
});

// ── BT-C03: Failure routed ────────────────────────────────────────────────────

describe("BT-C03: failure routed — failed step WITH failure edge → continues", () => {
  beforeEach(() => {
    resetAll();

    const definition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "work",
          kind: "agent_step",
          label: "Work",
          position: { x: 1, y: 0 },
          instructions: "do it",
        },
        {
          id: "error_handler",
          kind: "agent_step",
          label: "Handle Error",
          position: { x: 2, y: 0 },
          instructions: "handle",
        },
        { id: "end", kind: "end", label: "End", position: { x: 3, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "work", when: "success" },
        { id: "e2", source: "work", target: "end", when: "success" },
        { id: "e3", source: "work", target: "error_handler", when: "failure" }, // failure edge
        { id: "e4", source: "error_handler", target: "end", when: "success" },
      ],
    };

    const workStepRun = makeStepRun({ id: "step-work-2", nodeId: "work" });
    stepRunIdToNodeId["step-work-2"] = "work";
    stepRunIdToStepRun["step-work-2"] = workStepRun;
    currentStepRun = workStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: definition as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-work-2",
    });
    currentLoop = makeLoop();

    executorOutcomes["work"] = {
      outcome: "failure",
      errorKind: "sandbox_unavailable",
      errorMessage: "Sandbox failed",
    };
  });

  test("BT-C03: failure edge exists → run NOT failed, dispatch to error_handler", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-2",
      workflowRunId: "wf-run-1",
    });

    // Run should NOT be in failed status
    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeUndefined();

    // Should have dispatched the next step
    expect(workflowStartCalls.length).toBe(1);

    // Advance should target error_handler
    const advanceCall = recordedAdvanceCalls[0];
    expect(advanceCall?.nextNodeId).toBe("error_handler");
  });
});

// ── BT-C04: chain_route_missing ───────────────────────────────────────────────

describe("BT-C04: chain_route_missing — dangling/null route on success", () => {
  beforeEach(() => {
    resetAll();

    // A graph where the success edge target doesn't exist in nodes (dangling)
    const definition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "work",
          kind: "agent_step",
          label: "Work",
          position: { x: 1, y: 0 },
          instructions: "do it",
        },
        // No "next" node declared
      ],
      edges: [
        { id: "e1", source: "start", target: "work", when: "success" },
        { id: "e2", source: "work", target: "phantom_node", when: "success" }, // dangling
      ],
    };

    const workStepRun = makeStepRun({ id: "step-work-3", nodeId: "work" });
    stepRunIdToNodeId["step-work-3"] = "work";
    stepRunIdToStepRun["step-work-3"] = workStepRun;
    currentStepRun = workStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: definition as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-work-3",
    });
    currentLoop = makeLoop();

    executorOutcomes["work"] = { outcome: "success" };
  });

  test("BT-C04: dangling success edge → run failed with chain_route_missing", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-3",
      workflowRunId: "wf-run-1",
    });

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("chain_route_missing");
  });

  test("BT-C04: chain_route_missing event emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-3",
      workflowRunId: "wf-run-1",
    });

    const routeMissingEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.route_missing",
    );
    expect(routeMissingEvent).toBeDefined();
  });

  test("BT-C04: no dispatch when route is missing", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-3",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── BT-C05: Guardrails ────────────────────────────────────────────────────────

describe("BT-C05: guardrails", () => {
  function makeRunningRun(overrides: Partial<AgentLoopRun> = {}) {
    return makeLoopRun({
      status: "running",
      startedAt: new Date(Date.now() - 60_000), // 1 minute ago
      ...overrides,
    });
  }

  function makeStepRunForNode(nodeId: string, id: string) {
    const sr = makeStepRun({ id, nodeId, nodeKind: "agent_step" });
    stepRunIdToNodeId[id] = nodeId;
    stepRunIdToStepRun[id] = sr;
    return sr;
  }

  function makeDefinitionWithWork() {
    return {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
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
  }

  beforeEach(() => {
    resetAll();
  });

  test("BT-C05: stepCount >= maxStepsPerRun → guardrail.tripped + run failed + no dispatch", async () => {
    const sr = makeStepRunForNode("work", "step-guard-1");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-guard-1",
      stepCount: 50, // exactly at default maxStepsPerRun ceiling
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-guard-1",
      workflowRunId: "wf-run-1",
    });

    const trippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.guardrail.tripped",
    );
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("guardrail_exceeded");

    expect(workflowStartCalls.length).toBe(0);
    expect(executedNodeIds.length).toBe(0); // executor NOT called
  });

  test("BT-C05: iterationCount >= maxIterations → guardrail.tripped", async () => {
    const sr = makeStepRunForNode("work", "step-guard-2");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-guard-2",
      stepCount: 5,
      iterationCount: 10, // exactly at default maxIterations
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-guard-2",
      workflowRunId: "wf-run-1",
    });

    const trippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.guardrail.tripped",
    );
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("guardrail_exceeded");
  });

  test("cancel winning the guardrail CAS suppresses terminal and step evidence", async () => {
    const sr = makeStepRunForNode("work", "step-guard-cancelled");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: sr.id,
      stepCount: 50,
    });
    transitionShouldWin = false;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: sr.id,
      workflowRunId: "wf-cancelled",
    });

    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledTimes(1);
    expect(updateAgentLoopStepRunMock).not.toHaveBeenCalled();
    expect(
      recordedEvents.some(
        (event) =>
          event.eventName === "agent-loop.guardrail.tripped" ||
          event.eventName === "agent-loop.run.failed",
      ),
    ).toBe(false);
  });

  test("BT-C05: wall-clock exceeds maxRunDurationMs → guardrail.tripped", async () => {
    const sr = makeStepRunForNode("work", "step-guard-3");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-guard-3",
      stepCount: 5,
      iterationCount: 0,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago > 2h default
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-guard-3",
      workflowRunId: "wf-run-1",
    });

    const trippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.guardrail.tripped",
    );
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate?.errorKind).toBe("guardrail_exceeded");
  });

  test("BT-C05: user guardrails clamped to ceilings — cannot exceed 200 steps", async () => {
    const { resolveGuardrails } = await chainPromise;
    // User requests 500 steps — should be clamped to ceiling 200
    const resolved = resolveGuardrails({ maxStepsPerRun: 500 });
    expect(resolved.maxStepsPerRun).toBe(200);
  });

  test("BT-C05: user guardrails clamped to ceilings — cannot exceed 50 iterations", async () => {
    const { resolveGuardrails } = await chainPromise;
    const resolved = resolveGuardrails({ maxIterations: 999 });
    expect(resolved.maxIterations).toBe(50);
  });

  test("BT-C05: resolveGuardrails defaults stepTimeoutMs to 10 minutes when unset (#766)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const { GUARDRAIL_DEFAULTS } = await import("./types");
    const resolved = resolveGuardrails(null);
    expect(resolved.stepTimeoutMs).toBe(GUARDRAIL_DEFAULTS.stepTimeoutMs);
  });

  test("BT-C05: resolveGuardrails clamps stepTimeoutMs to the 30-minute ceiling (#766)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const { GUARDRAIL_CEILINGS } = await import("./types");
    const resolved = resolveGuardrails({ stepTimeoutMs: 60 * 60 * 1000 });
    expect(resolved.stepTimeoutMs).toBe(GUARDRAIL_CEILINGS.stepTimeoutMs);
  });

  test("BT-C05: resolveGuardrails passes through a valid user stepTimeoutMs (#766)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const resolved = resolveGuardrails({ stepTimeoutMs: 5 * 60 * 1000 });
    expect(resolved.stepTimeoutMs).toBe(5 * 60 * 1000);
  });

  test("BT-C05: runAgentLoopStep forwards the resolved (clamped) stepTimeoutMs to executeAgentLoopStep (#766)", async () => {
    const sr = makeStepRunForNode("work", "step-guard-timeout");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-guard-timeout",
      stepCount: 0,
      iterationCount: 0,
    });
    // User requests a stepTimeoutMs above the 30-minute ceiling — must be clamped.
    currentLoop = makeLoop({
      guardrails: { stepTimeoutMs: 60 * 60 * 1000 },
    });

    const { runAgentLoopStep } = await chainPromise;
    const { GUARDRAIL_CEILINGS } = await import("./types");
    await runAgentLoopStep({
      stepRunId: "step-guard-timeout",
      workflowRunId: "wf-run-1",
    });

    const call = executeAgentLoopStepMock.mock.calls.find(
      (c) => (c[0] as { stepRunId: string }).stepRunId === "step-guard-timeout",
    );
    expect(call).toBeDefined();
    const callArgs = call?.[0] as { stepTimeoutMs?: number };
    expect(callArgs.stepTimeoutMs).toBe(GUARDRAIL_CEILINGS.stepTimeoutMs);
  });

  test("BT-C05: resolveGuardrails defaults maxAgentTurnsPerStep to 8 (#862)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const resolved = resolveGuardrails(null);
    expect(resolved.maxAgentTurnsPerStep).toBe(8);
  });

  test("BT-C05: resolveGuardrails clamps maxAgentTurnsPerStep to the ceiling of 32 (#862)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const resolved = resolveGuardrails({ maxAgentTurnsPerStep: 500 });
    expect(resolved.maxAgentTurnsPerStep).toBe(32);
  });

  test("BT-C05: resolveGuardrails passes through a valid user maxAgentTurnsPerStep (#862)", async () => {
    const { resolveGuardrails } = await chainPromise;
    const resolved = resolveGuardrails({ maxAgentTurnsPerStep: 12 });
    expect(resolved.maxAgentTurnsPerStep).toBe(12);
  });

  test("BT-C05: loopGuardrailsSchema accepts maxAgentTurnsPerStep (#862)", async () => {
    const { loopGuardrailsSchema } = await import("./types");
    const result = loopGuardrailsSchema.safeParse({ maxAgentTurnsPerStep: 12 });
    expect(result.success).toBe(true);
  });

  test("accepted snapshot guardrails survive a live edit and still pass current ceilings", async () => {
    const definition = makeDefinitionWithWork();
    const accepted = makeLoop({
      definition,
      guardrails: {
        stepTimeoutMs: 5 * 60 * 1000,
        maxAgentTurnsPerStep: 12,
      },
    });
    const snapshot = buildAgentLoopExecutionSnapshot(accepted);
    currentLoopRun = makeRunningRun({
      definitionSnapshot: snapshot.definition,
      executionSnapshot: snapshot,
      definitionVersion: 1,
      definitionHash: hashAgentLoopExecutionSnapshot(snapshot),
      currentNodeId: "work",
      currentStepRunId: "step-frozen-guardrails",
    });
    currentStepRun = makeStepRunForNode("work", "step-frozen-guardrails");
    currentLoop = toAgentLoopExecutionPolicy(
      currentLoopRun,
      makeLoop({
        definition,
        guardrails: { stepTimeoutMs: 1, maxAgentTurnsPerStep: 1 },
      }),
    ).loop as unknown as AgentLoop;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: currentStepRun.id,
      workflowRunId: "wf-frozen-guardrails",
    });

    const call = executeAgentLoopStepMock.mock.calls.find(
      (candidate) =>
        (candidate[0] as { stepRunId: string }).stepRunId ===
        "step-frozen-guardrails",
    );
    expect(call?.[0]).toMatchObject({
      stepTimeoutMs: 5 * 60 * 1000,
      maxAgentTurnsPerStep: 12,
    });
  });
});

// ── BT-C06: Cooperative — paused/cancelled before execution ──────────────────

describe("BT-C06: cooperative check — paused/cancelled → skipped, no execution", () => {
  function makeInactiveRun(
    status: "paused" | "cancelled" | "completed" | "failed",
  ) {
    return makeLoopRun({
      status,
      currentNodeId: "work",
      currentStepRunId: "step-inactive-1",
    });
  }

  beforeEach(() => {
    resetAll();

    const sr = makeStepRun({
      id: "step-inactive-1",
      nodeId: "work",
      nodeKind: "agent_step",
    });
    stepRunIdToNodeId["step-inactive-1"] = "work";
    stepRunIdToStepRun["step-inactive-1"] = sr;
    currentStepRun = sr;
    currentLoop = makeLoop();
  });

  test("BT-C06: paused run → skipped event, executor NOT called, no dispatch", async () => {
    currentLoopRun = makeInactiveRun("paused");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-inactive-1",
      workflowRunId: "wf-run-1",
    });

    expect(executedNodeIds.length).toBe(0);
    expect(workflowStartCalls.length).toBe(0);

    const skippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skippedEvent).toBeDefined();
  });

  test("BT-C06: cancelled run → skipped event, executor NOT called, no dispatch", async () => {
    currentLoopRun = makeInactiveRun("cancelled");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-inactive-1",
      workflowRunId: "wf-run-1",
    });

    expect(executedNodeIds.length).toBe(0);
    expect(workflowStartCalls.length).toBe(0);

    const skippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skippedEvent).toBeDefined();
  });

  test("BT-C06: completed run → skipped event, executor NOT called", async () => {
    currentLoopRun = makeInactiveRun("completed");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-inactive-1",
      workflowRunId: "wf-run-1",
    });

    expect(executedNodeIds.length).toBe(0);
    const skippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skippedEvent).toBeDefined();
  });
});

// ── BT-C07: Cooperative — queued → running ───────────────────────────────────

describe("BT-C07: cooperative check — queued → running transition", () => {
  beforeEach(() => {
    resetAll();

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
    stepRunIdToNodeId["step-run-1"] = "start";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({ status: "queued" });
    currentLoop = makeLoop();
    executorOutcomes["start"] = { outcome: "success" };
  });

  test("BT-C07: queued run transitions to running before execution", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const runningUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "running",
    );
    expect(runningUpdate).toBeDefined();
    // Running update should come BEFORE any execution (executor called AFTER status change)
    expect(executedNodeIds).toContain("start");
  });

  test("BT-C07: run.started event emitted exactly once for queued run", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const startedEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(startedEvents.length).toBe(1);
  });

  test("BT-C07: already running run does NOT emit run.started again", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const startedEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(startedEvents.length).toBe(0);
  });
});

// ── BT-C08: Double-advance ────────────────────────────────────────────────────

describe("BT-C08: double-advance — conditional update returns 0 rows → no second dispatch", () => {
  beforeEach(() => {
    resetAll();

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
    stepRunIdToNodeId["step-run-1"] = "start";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentStepRunId: "step-run-1",
    });
    currentLoop = makeLoop();
    executorOutcomes["start"] = { outcome: "success" };
    advanceRunRowsUpdated = 0; // Simulate 0 rows updated (already advanced)
  });

  test("BT-C08: when advanceRunToNextStep returns false → no dispatch, duplicate_advance event", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    // No dispatch should happen
    expect(workflowStartCalls.length).toBe(0);

    // Should record a skipped/duplicate event
    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    // Check that the reason indicates duplicate_advance
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("duplicate_advance");
  });
});

describe("source deletion during atomic advance", () => {
  beforeEach(() => {
    resetAll();
    currentLoopRun = makeLoopRun({
      status: "running",
      currentStepRunId: "step-run-1",
    });
    executorOutcomes["start"] = { outcome: "success" };
    atomicAdvanceSourceDeleted = true;
  });

  test("does not create, dispatch, or mislabel a duplicate step", async () => {
    const { runAgentLoopStep } = await chainPromise;

    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(recordedStepRunCreations).toHaveLength(0);
    expect(recordedAdvanceCalls).toHaveLength(0);
    expect(workflowStartCalls).toHaveLength(0);
    expect(
      recordedEvents.some(
        (event) =>
          event.eventName === "agent-loop.chain.skipped" &&
          (event.payload as { reason?: string } | null)?.reason ===
            "duplicate_advance",
      ),
    ).toBe(false);
  });
});

describe("source deletion after atomic advance", () => {
  beforeEach(() => {
    resetAll();
    currentLoopRun = makeLoopRun({
      status: "running",
      currentStepRunId: "step-run-1",
    });
    executorOutcomes["start"] = { outcome: "success" };
    sourceLiveBeforeDispatch = false;
  });

  test("rechecks the source and skips dispatch after the advance commits", async () => {
    const { runAgentLoopStep } = await chainPromise;

    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(recordedStepRunCreations).toHaveLength(1);
    expect(recordedAdvanceCalls).toHaveLength(1);
    expect(isAgentLoopRunSourceLiveMock).toHaveBeenCalledWith("loop-run-1", {
      repoOwner: "acme",
      repoName: "my-repo",
    });
    expect(workflowStartCalls).toHaveLength(0);
    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledWith({
      runId: "loop-run-1",
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "execution_revoked",
      errorMessage: "Loop execution authorization was revoked before dispatch.",
    });
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.execution.revoked",
        payload: { errorKind: "execution_revoked" },
      }),
    );
  });

  test("losing the revocation CAS preserves a concurrent control result", async () => {
    transitionShouldWin = false;
    const { runAgentLoopStep } = await chainPromise;

    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledTimes(1);
    expect(workflowStartCalls).toHaveLength(0);
    expect(
      recordedEvents.some(
        (event) => event.eventName === "agent-loop.execution.revoked",
      ),
    ).toBe(false);
  });
});

// ── BT-C09: Dispatch-throw ────────────────────────────────────────────────────

describe("BT-C09: dispatch-throw — start() throws → dispatch_failed, run recoverable", () => {
  beforeEach(() => {
    resetAll();

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
    stepRunIdToNodeId["step-run-1"] = "start";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentStepRunId: "step-run-1",
    });
    currentLoop = makeLoop();
    executorOutcomes["start"] = { outcome: "success" };
    workflowStartThrows = new Error("Workflow service unavailable");
  });

  test("BT-C09: dispatch_failed event recorded on start() throw", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    const dispatchFailedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.dispatch_failed",
    );
    expect(dispatchFailedEvent).toBeDefined();
  });

  test("BT-C09: run remains in running status (recoverable) after dispatch failure", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    // Run should NOT be failed — it remains in a recoverable state
    const finalRunUpdate = recordedRunStatusUpdates.filter(
      (u) => u.status === "failed",
    );
    expect(finalRunUpdate.length).toBe(0);
  });
});

// ── BT-C10: unexpected executor errors are terminal and observable ───────────

describe("BT-C10: unexpected executor error — fail closed without workflow retry", () => {
  beforeEach(() => {
    resetAll();

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "work" });
    stepRunIdToNodeId["step-run-1"] = "work";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-run-1",
    });
    executorThrows = new Error("unexpected executor failure");
  });

  test("records a typed step failure and fails the run", async () => {
    const { runAgentLoopStep } = await chainPromise;

    await runAgentLoopStep({
      stepRunId: "step-run-1",
      workflowRunId: "wf-run-1",
    });

    expect(updateAgentLoopStepRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stepRunId: "step-run-1",
        status: "failed",
        errorKind: "workflow_failed",
        errorMessage: "unexpected executor failure",
      }),
    );
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.step.failed",
        status: "failed",
        payload: expect.objectContaining({
          errorKind: "workflow_failed",
        }),
      }),
    );
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.run.failed",
        status: "failed",
      }),
    );
  });
});

// ── BT-C11: end node — no dispatch ───────────────────────────────────────────

describe("BT-C11: end node — no dispatch after run completion", () => {
  beforeEach(() => {
    resetAll();

    const endStepRun = makeStepRun({
      id: "step-end-1",
      nodeId: "end",
      nodeKind: "end",
    });
    stepRunIdToNodeId["step-end-1"] = "end";
    stepRunIdToStepRun["step-end-1"] = endStepRun;
    currentStepRun = endStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "end",
      currentStepRunId: "step-end-1",
    });
    currentLoop = makeLoop();

    // End node executor marks run as completed
    executorOutcomes["end"] = { outcome: "success" };
    endNodeIds = new Set(["end"]);
  });

  test("BT-C11: end node step run → no edge evaluation, no dispatch", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-end-1",
      workflowRunId: "wf-run-1",
    });

    expect(workflowStartCalls.length).toBe(0);

    // No edge.evaluated event should be emitted for end nodes
    const edgeEvents = recordedEvents.filter(
      (e) => e.eventName === "agent-loop.edge.evaluated",
    );
    expect(edgeEvents.length).toBe(0);
  });

  test("BT-C11: run remains completed after end node", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-end-1",
      workflowRunId: "wf-run-1",
    });

    // Run should be completed (set by executor mock) and not re-transitioned
    expect(currentLoopRun.status).toBe("completed");
  });
});

// ── BT-C12: Watchdog branch — watchdogEnabled=true on failed step with no failure edge ──

describe("BT-C12: watchdog branch — failed step, no failure edge, watchdogEnabled=true", () => {
  const definition = {
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
      // No failure edge from work
    ],
  };

  beforeEach(() => {
    resetAll();

    const workStepRun = makeStepRun({ id: "step-work-wd", nodeId: "work" });
    stepRunIdToNodeId["step-work-wd"] = "work";
    stepRunIdToStepRun["step-work-wd"] = workStepRun;
    currentStepRun = workStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: definition as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-work-wd",
    });
    // Enable watchdog on the loop
    currentLoop = makeLoop({
      watchdogEnabled: true,
      watchdogRetryBudget: 2,
    });

    executorOutcomes["work"] = {
      outcome: "failure",
      errorKind: "sandbox_unavailable",
      errorMessage: "Sandbox failed",
    };

    // Default: invokeWatchdog resolves with retry decision
    invokeWatchdogMock.mockImplementation(async () => ({
      invoked: true,
      decision: "retry" as const,
    }));
  });

  test("BT-C12a: watchdogEnabled=true → invokeWatchdog called, run NOT double-marked failed", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    // invokeWatchdog should have been called exactly once
    expect(invokeWatchdogMock).toHaveBeenCalledTimes(1);

    // The run should NOT be marked failed (watchdog owns state)
    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeUndefined();
  });

  test("BT-C12b: watchdogEnabled=true → invokeWatchdog receives real attempt and errorMessage", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    expect(invokeWatchdogMock).toHaveBeenCalledTimes(1);
    const callArgs = invokeWatchdogMock.mock.calls[0]![0] as {
      attempt: number;
      errorMessage: string;
    };
    // attempt should be the stepRun.attempt (1), not hardcoded 1 from elsewhere
    expect(callArgs.attempt).toBe(1);
    // errorMessage should be the real error from the executor, not the fallback string
    expect(callArgs.errorMessage).toBe("Sandbox failed");
  });

  test("stale terminal failure replay does not route or invoke watchdog after the run advanced", async () => {
    const staleFailedStep = makeStepRun({
      id: "step-work-wd",
      nodeId: "work",
      nodeKind: "agent_step",
      status: "failed",
      errorKind: "sandbox_unavailable",
      errorMessage: "Sandbox failed",
      finishedAt: new Date(),
    });
    currentStepRun = staleFailedStep;
    stepRunIdToStepRun[staleFailedStep.id] = staleFailedStep;
    currentLoopRun = makeLoopRun({
      status: "running",
      definitionSnapshot: definition as Record<string, unknown>,
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
      currentNodeId: "work",
      currentStepRunId: "step-work-wd-attempt-2",
    });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: staleFailedStep.id,
      workflowRunId: "wf-stale-delivery",
    });

    expect(invokeWatchdogMock).not.toHaveBeenCalled();
    expect(recordedStepRunCreations).toHaveLength(0);
    expect(workflowStartCalls).toHaveLength(0);
  });

  test("BT-C12c: invokeWatchdog throws → fall back to fail-fast (watchdog bug safety)", async () => {
    // Simulate watchdog bug: invokeWatchdog throws
    invokeWatchdogMock.mockImplementation(async () => {
      throw new Error("Watchdog internal bug");
    });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    // invokeWatchdog was called (and threw)
    expect(invokeWatchdogMock).toHaveBeenCalledTimes(1);

    // Fail-fast fallback: run should now be marked failed
    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
  });

  test("BT-C12d: watchdogEnabled=false → invokeWatchdog NOT called, fail-fast applies", async () => {
    currentLoop = makeLoop({ watchdogEnabled: false });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    // Watchdog should not be called when disabled
    expect(invokeWatchdogMock).not.toHaveBeenCalled();

    // Fail-fast should apply
    const failedUpdate = recordedRunStatusUpdates.find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
  });

  test("watchdog live denial terminalizes the run through a winner-only CAS", async () => {
    invokeWatchdogMock.mockResolvedValue({
      invoked: false,
      decision: "retry",
    });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledWith({
      runId: "loop-run-1",
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "execution_revoked",
      errorMessage:
        "Loop execution authorization was revoked before watchdog action.",
    });
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.execution.revoked",
        payload: { errorKind: "execution_revoked" },
      }),
    );
  });

  test("watchdog live-denial CAS loser emits no contradictory revocation", async () => {
    invokeWatchdogMock.mockResolvedValue({
      invoked: false,
      decision: "retry",
    });
    transitionShouldWin = false;

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-work-wd",
      workflowRunId: "wf-run-1",
    });

    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalledTimes(1);
    expect(
      recordedEvents.some(
        (event) => event.eventName === "agent-loop.execution.revoked",
      ),
    ).toBe(false);
  });
});
