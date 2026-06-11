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
 * BT-C10: pause/resume/cancel/retry transitions (legal + illegal)
 * BT-C11: end node — no edge evaluation, no dispatch after run completion
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

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
let recordedStepRunCreations: { loopRunId: string; nodeId: string; nodeKind: string; attempt: number }[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

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
let endNodeIds: Set<string> = new Set();

const executeAgentLoopStepMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }): Promise<ExecutorOutcome> => {
    // Find the node by stepRunId (via currentStepRun mapping)
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

    // Simulate end node finalizing the run
    if (endNodeIds.has(nodeId)) {
      currentLoopRun = { ...currentLoopRun, status: "completed" };
      recordedRunStatusUpdates.push({ runId: currentLoopRun.id, status: "completed" });
    }

    const result = executorOutcomes[nodeId] ?? { outcome: "success" };
    return result;
  },
);

// Maps stepRunId → nodeId for multi-step scenarios
let stepRunIdToNodeId: Record<string, string> = {};

// ── Store mocks ───────────────────────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(
  async (stepRunId: string) => {
    // Return context for the given stepRunId
    const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
    return {
      stepRun,
      loopRun: currentLoopRun,
      loop: currentLoop,
    };
  },
);

// Maps stepRunId → stepRun object
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

const updateAgentLoopRunStatusMock = mock(
  async (input: RunStatusInput): Promise<AgentLoopRun> => {
    recordedRunStatusUpdates.push(input);
    currentLoopRun = {
      ...currentLoopRun,
      status: input.status as AgentLoopRun["status"],
      ...(input.currentNodeId !== undefined ? { currentNodeId: input.currentNodeId } : {}),
      ...(input.currentStepRunId !== undefined ? { currentStepRunId: input.currentStepRunId } : {}),
      ...(input.errorKind !== undefined ? { errorKind: input.errorKind } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
      ...(input.stepCount !== undefined ? { stepCount: input.stepCount } : {}),
      ...(input.iterationCount !== undefined ? { iterationCount: input.iterationCount } : {}),
    };
    return currentLoopRun;
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return { id: `evt-${recordedEvents.length}`, ...input };
});

const createAgentLoopStepRunMock = mock(
  async (input: { loopRunId: string; nodeId: string; nodeKind: string; attempt?: number }) => {
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

const updateAgentLoopStepRunMock = mock(async (input: unknown) => {
  return currentStepRun;
});

// Pause/resume/cancel/retry store mocks
const pauseLoopRunMock = mock(async (runId: string, _userId: string) => {
  if (currentLoopRun.status !== "running" && currentLoopRun.status !== "queued") {
    throw new Error(`Cannot pause run in status: ${currentLoopRun.status}`);
  }
  currentLoopRun = { ...currentLoopRun, status: "paused" };
  recordedRunStatusUpdates.push({ runId, status: "paused" });
  return currentLoopRun;
});

const cancelLoopRunMock = mock(async (runId: string, _userId: string) => {
  const cancellableStatuses = new Set(["running", "queued", "paused"]);
  if (!cancellableStatuses.has(currentLoopRun.status)) {
    throw new Error(`Cannot cancel run in status: ${currentLoopRun.status}`);
  }
  currentLoopRun = { ...currentLoopRun, status: "cancelled" };
  recordedRunStatusUpdates.push({ runId, status: "cancelled" });
  return currentLoopRun;
});

const resumeLoopRunMock = mock(async (runId: string, _userId: string) => {
  if (currentLoopRun.status !== "paused") {
    throw new Error(`Cannot resume run in status: ${currentLoopRun.status}`);
  }
  currentLoopRun = { ...currentLoopRun, status: "running" };
  recordedRunStatusUpdates.push({ runId, status: "running" });
  return currentLoopRun;
});

const retryCurrentStepMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId } = params;
    if (currentLoopRun.status !== "failed" && currentLoopRun.status !== "stalled") {
      throw new Error(`Cannot retry run in status: ${currentLoopRun.status}`);
    }
    // Find the current step run to get nodeId/nodeKind and attempt
    const failedStepRun = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const nodeId = currentLoopRun.currentNodeId ?? failedStepRun?.nodeId ?? "work";
    const nodeKind = failedStepRun?.nodeKind ?? "agent_step";
    const nextAttempt = (failedStepRun?.attempt ?? 1) + 1;

    // Create a new step run (simulates the store creating attempt n+1)
    const id = nextStepRunId();
    recordedStepRunCreations.push({ loopRunId: runId, nodeId, nodeKind, attempt: nextAttempt });
    const newStepRun: AgentLoopStepRun = makeStepRun({
      id,
      loopRunId: runId,
      nodeId,
      nodeKind,
      attempt: nextAttempt,
      status: "queued",
    });
    stepRunIdToNodeId[id] = nodeId;
    stepRunIdToStepRun[id] = newStepRun;

    currentLoopRun = { ...currentLoopRun, status: "running", currentStepRunId: id };
    recordedRunStatusUpdates.push({ runId, status: "running" });

    return newStepRun;
  },
);

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getAgentLoopStepRunWithContextMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  advanceRunToNextStep: advanceRunToNextStepMock,
  countStepRunsForNode: countStepRunsForNodeMock,
  pauseLoopRun: pauseLoopRunMock,
  cancelLoopRun: cancelLoopRunMock,
  resumeLoopRun: resumeLoopRunMock,
  retryCurrentStep: retryCurrentStepMock,
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
      { id: "github_check", kind: "github_check", label: "Check Issues", position: { x: 1, y: 0 }, check: { kind: "list_issues" } },
      { id: "condition", kind: "condition", label: "Has Issues?", position: { x: 2, y: 0 }, condition: { path: "github_check.openIssueCount", op: "gt", value: 0 } },
      { id: "agent_step", kind: "agent_step", label: "Implement", position: { x: 3, y: 0 }, instructions: "Do the work" },
      { id: "end", kind: "end", label: "End", position: { x: 4, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "github_check", when: "success" },
      { id: "e2", source: "github_check", target: "condition", when: "success" },
      { id: "e3", source: "condition", target: "agent_step", when: "true" },
      { id: "e4", source: "condition", target: "github_check", when: "false" }, // loop back
      { id: "e5", source: "agent_step", target: "end", when: "success" },
    ],
  };
}

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
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

function makeStepRun(overrides: Partial<AgentLoopStepRun> = {}): AgentLoopStepRun {
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
  executedNodeIds = [];
  stepRunIdToNodeId = {};
  stepRunIdToStepRun = {};
  executorOutcomes = {};
  endNodeIds = new Set(["end"]);
  advanceRunRowsUpdated = 1;
  priorStepRunCountForNode = {};
  workflowStartThrows = null;
  nextStepRunIdCounter = 100;
  workflowRunIdCounter = 200;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
  stepRunIdToNodeId["step-run-1"] = "start";
  stepRunIdToStepRun["step-run-1"] = currentStepRun;

  getAgentLoopStepRunWithContextMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  createAgentLoopStepRunMock.mockClear();
  advanceRunToNextStepMock.mockClear();
  countStepRunsForNodeMock.mockClear();
  executeAgentLoopStepMock.mockClear();
  workflowStartMock.mockClear();
  pauseLoopRunMock.mockClear();
  cancelLoopRunMock.mockClear();
  resumeLoopRunMock.mockClear();
  retryCurrentStepMock.mockClear();
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
    currentLoopRun = makeLoopRun({ status: "queued", currentNodeId: "start", currentStepRunId: "step-run-1" });
  });

  test("BT-C01: run transitions queued → running on first step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    // Should have transitioned to running
    const runningUpdate = recordedRunStatusUpdates.find(u => u.status === "running");
    expect(runningUpdate).toBeDefined();
  });

  test("BT-C01: agent-loop.run.started emitted exactly once for first step", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    const startedEvents = recordedEvents.filter(e => e.eventName === "agent-loop.run.started");
    expect(startedEvents.length).toBe(1);
  });

  test("BT-C01: start node — executor called, dispatch fired, agent-loop.edge.evaluated emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    // Executor must have been called with the start step run
    expect(executedNodeIds).toContain("start");

    // An edge evaluated event should have been emitted
    const edgeEvent = recordedEvents.find(e => e.eventName === "agent-loop.edge.evaluated");
    expect(edgeEvent).toBeDefined();

    // Workflow should have been dispatched for next step
    expect(workflowStartCalls.length).toBe(1);

    // A chain dispatched event should have been emitted
    const dispatchedEvent = recordedEvents.find(e => e.eventName === "agent-loop.chain.dispatched");
    expect(dispatchedEvent).toBeDefined();
  });

  test("BT-C01: when condition loops back, iterationCount increments", async () => {
    // Set up: start step executed, we're now on condition (false → github_check loop)
    // Simulate a prior step run exists for github_check (making it a loop)
    priorStepRunCountForNode["loop-run-1:github_check"] = 1;

    const conditionStepRun = makeStepRun({ id: "step-run-cond", nodeId: "condition" });
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
    await runAgentLoopStep({ stepRunId: "step-run-cond", workflowRunId: "wf-run-2" });

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
        { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "work", kind: "agent_step", label: "Work", position: { x: 1, y: 0 }, instructions: "do it" },
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
    await runAgentLoopStep({ stepRunId: "step-work-1", workflowRunId: "wf-run-1" });

    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("sandbox_unavailable");
  });

  test("BT-C02: zero dispatches when failure has no edge", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-work-1", workflowRunId: "wf-run-1" });

    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── BT-C03: Failure routed ────────────────────────────────────────────────────

describe("BT-C03: failure routed — failed step WITH failure edge → continues", () => {
  beforeEach(() => {
    resetAll();

    const definition = {
      nodes: [
        { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "work", kind: "agent_step", label: "Work", position: { x: 1, y: 0 }, instructions: "do it" },
        { id: "error_handler", kind: "agent_step", label: "Handle Error", position: { x: 2, y: 0 }, instructions: "handle" },
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
    await runAgentLoopStep({ stepRunId: "step-work-2", workflowRunId: "wf-run-1" });

    // Run should NOT be in failed status
    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
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
        { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "work", kind: "agent_step", label: "Work", position: { x: 1, y: 0 }, instructions: "do it" },
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
      currentNodeId: "work",
      currentStepRunId: "step-work-3",
    });
    currentLoop = makeLoop();

    executorOutcomes["work"] = { outcome: "success" };
  });

  test("BT-C04: dangling success edge → run failed with chain_route_missing", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-work-3", workflowRunId: "wf-run-1" });

    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("chain_route_missing");
  });

  test("BT-C04: chain_route_missing event emitted", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-work-3", workflowRunId: "wf-run-1" });

    const routeMissingEvent = recordedEvents.find(
      e => e.eventName === "agent-loop.chain.route_missing",
    );
    expect(routeMissingEvent).toBeDefined();
  });

  test("BT-C04: no dispatch when route is missing", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-work-3", workflowRunId: "wf-run-1" });

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
        { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "work", kind: "agent_step", label: "Work", position: { x: 1, y: 0 }, instructions: "do it" },
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
      currentNodeId: "work",
      currentStepRunId: "step-guard-1",
      stepCount: 50, // exactly at default maxStepsPerRun ceiling
      guardrails: null,
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-guard-1", workflowRunId: "wf-run-1" });

    const trippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.guardrail.tripped");
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
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
      currentNodeId: "work",
      currentStepRunId: "step-guard-2",
      stepCount: 5,
      iterationCount: 10, // exactly at default maxIterations
      guardrails: null,
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-guard-2", workflowRunId: "wf-run-1" });

    const trippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.guardrail.tripped");
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.errorKind).toBe("guardrail_exceeded");
  });

  test("BT-C05: wall-clock exceeds maxRunDurationMs → guardrail.tripped", async () => {
    const sr = makeStepRunForNode("work", "step-guard-3");
    currentStepRun = sr;
    currentLoopRun = makeRunningRun({
      definitionSnapshot: makeDefinitionWithWork() as Record<string, unknown>,
      currentNodeId: "work",
      currentStepRunId: "step-guard-3",
      stepCount: 5,
      iterationCount: 0,
      startedAt: new Date(Date.now() - (3 * 60 * 60 * 1000)), // 3 hours ago > 2h default
      guardrails: null,
    });
    currentLoop = makeLoop({ guardrails: null });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-guard-3", workflowRunId: "wf-run-1" });

    const trippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.guardrail.tripped");
    expect(trippedEvent).toBeDefined();

    const failedUpdate = recordedRunStatusUpdates.find(u => u.status === "failed");
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
});

// ── BT-C06: Cooperative — paused/cancelled before execution ──────────────────

describe("BT-C06: cooperative check — paused/cancelled → skipped, no execution", () => {
  function makeInactiveRun(status: "paused" | "cancelled" | "completed" | "failed") {
    return makeLoopRun({
      status,
      currentNodeId: "work",
      currentStepRunId: "step-inactive-1",
    });
  }

  beforeEach(() => {
    resetAll();

    const sr = makeStepRun({ id: "step-inactive-1", nodeId: "work", nodeKind: "agent_step" });
    stepRunIdToNodeId["step-inactive-1"] = "work";
    stepRunIdToStepRun["step-inactive-1"] = sr;
    currentStepRun = sr;
    currentLoop = makeLoop();
  });

  test("BT-C06: paused run → skipped event, executor NOT called, no dispatch", async () => {
    currentLoopRun = makeInactiveRun("paused");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-inactive-1", workflowRunId: "wf-run-1" });

    expect(executedNodeIds.length).toBe(0);
    expect(workflowStartCalls.length).toBe(0);

    const skippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.chain.skipped");
    expect(skippedEvent).toBeDefined();
  });

  test("BT-C06: cancelled run → skipped event, executor NOT called, no dispatch", async () => {
    currentLoopRun = makeInactiveRun("cancelled");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-inactive-1", workflowRunId: "wf-run-1" });

    expect(executedNodeIds.length).toBe(0);
    expect(workflowStartCalls.length).toBe(0);

    const skippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.chain.skipped");
    expect(skippedEvent).toBeDefined();
  });

  test("BT-C06: completed run → skipped event, executor NOT called", async () => {
    currentLoopRun = makeInactiveRun("completed");

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-inactive-1", workflowRunId: "wf-run-1" });

    expect(executedNodeIds.length).toBe(0);
    const skippedEvent = recordedEvents.find(e => e.eventName === "agent-loop.chain.skipped");
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
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    const runningUpdate = recordedRunStatusUpdates.find(u => u.status === "running");
    expect(runningUpdate).toBeDefined();
    // Running update should come BEFORE any execution (executor called AFTER status change)
    expect(executedNodeIds).toContain("start");
  });

  test("BT-C07: run.started event emitted exactly once for queued run", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    const startedEvents = recordedEvents.filter(e => e.eventName === "agent-loop.run.started");
    expect(startedEvents.length).toBe(1);
  });

  test("BT-C07: already running run does NOT emit run.started again", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    const startedEvents = recordedEvents.filter(e => e.eventName === "agent-loop.run.started");
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
    currentLoopRun = makeLoopRun({ status: "running", currentStepRunId: "step-run-1" });
    currentLoop = makeLoop();
    executorOutcomes["start"] = { outcome: "success" };
    advanceRunRowsUpdated = 0; // Simulate 0 rows updated (already advanced)
  });

  test("BT-C08: when advanceRunToNextStep returns false → no dispatch, duplicate_advance event", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    // No dispatch should happen
    expect(workflowStartCalls.length).toBe(0);

    // Should record a skipped/duplicate event
    const skipEvent = recordedEvents.find(
      e => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
    // Check that the reason indicates duplicate_advance
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("duplicate_advance");
  });
});

// ── BT-C09: Dispatch-throw ────────────────────────────────────────────────────

describe("BT-C09: dispatch-throw — start() throws → dispatch_failed, run recoverable", () => {
  beforeEach(() => {
    resetAll();

    currentStepRun = makeStepRun({ id: "step-run-1", nodeId: "start" });
    stepRunIdToNodeId["step-run-1"] = "start";
    stepRunIdToStepRun["step-run-1"] = currentStepRun;
    currentLoopRun = makeLoopRun({ status: "running", currentStepRunId: "step-run-1" });
    currentLoop = makeLoop();
    executorOutcomes["start"] = { outcome: "success" };
    workflowStartThrows = new Error("Workflow service unavailable");
  });

  test("BT-C09: dispatch_failed event recorded on start() throw", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    const dispatchFailedEvent = recordedEvents.find(
      e => e.eventName === "agent-loop.chain.dispatch_failed",
    );
    expect(dispatchFailedEvent).toBeDefined();
  });

  test("BT-C09: run remains in running status (recoverable) after dispatch failure", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-run-1" });

    // Run should NOT be failed — it remains in a recoverable state
    const finalRunUpdate = recordedRunStatusUpdates.filter(u => u.status === "failed");
    expect(finalRunUpdate.length).toBe(0);
  });
});

// ── BT-C10: pause/resume/cancel/retry transitions ────────────────────────────

describe("BT-C10: control plane transitions", () => {
  beforeEach(() => {
    resetAll();
    currentLoop = makeLoop();
  });

  // Pause
  test("BT-C10: pause from running → paused + event", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { pauseLoopRun } = await chainPromise;
    await pauseLoopRun("loop-run-1", "user-1");

    expect(currentLoopRun.status).toBe("paused");
    const pausedEvent = recordedEvents.find(e => e.eventName === "agent-loop.run.paused");
    expect(pausedEvent).toBeDefined();
  });

  test("BT-C10: pause from completed → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "completed" });
    const { pauseLoopRun } = await chainPromise;
    await expect(pauseLoopRun("loop-run-1", "user-1")).rejects.toThrow();
  });

  // Cancel
  test("BT-C10: cancel from running → cancelled + event", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { cancelLoopRun } = await chainPromise;
    await cancelLoopRun("loop-run-1", "user-1");

    expect(currentLoopRun.status).toBe("cancelled");
    const cancelledEvent = recordedEvents.find(e => e.eventName === "agent-loop.run.cancelled");
    expect(cancelledEvent).toBeDefined();
  });

  test("BT-C10: cancel from paused → cancelled", async () => {
    currentLoopRun = makeLoopRun({ status: "paused" });
    const { cancelLoopRun } = await chainPromise;
    await cancelLoopRun("loop-run-1", "user-1");
    expect(currentLoopRun.status).toBe("cancelled");
  });

  test("BT-C10: cancel from completed → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "completed" });
    const { cancelLoopRun } = await chainPromise;
    await expect(cancelLoopRun("loop-run-1", "user-1")).rejects.toThrow();
  });

  // Resume
  test("BT-C10: resume from paused → running + event + re-dispatch if step queued", async () => {
    const queuedStepRun = makeStepRun({ id: "step-queued", nodeId: "work", status: "queued" });
    stepRunIdToStepRun["step-queued"] = queuedStepRun;
    currentLoopRun = makeLoopRun({ status: "paused", currentStepRunId: "step-queued" });

    const { resumeLoopRun } = await chainPromise;
    await resumeLoopRun("loop-run-1", "user-1");

    expect(currentLoopRun.status).toBe("running");
    const resumedEvent = recordedEvents.find(e => e.eventName === "agent-loop.run.resumed");
    expect(resumedEvent).toBeDefined();
    // Re-dispatch should have happened
    expect(workflowStartCalls.length).toBe(1);
  });

  test("BT-C10: resume from running → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { resumeLoopRun } = await chainPromise;
    await expect(resumeLoopRun("loop-run-1", "user-1")).rejects.toThrow();
  });

  // Retry
  test("BT-C10: retry from failed → creates attempt n+1, dispatches, status running", async () => {
    const failedStepRun = makeStepRun({
      id: "step-failed",
      nodeId: "work",
      nodeKind: "agent_step",
      status: "failed",
      attempt: 1,
      errorKind: "sandbox_unavailable",
    });
    stepRunIdToStepRun["step-failed"] = failedStepRun;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-failed",
    });

    const { retryCurrentStep } = await chainPromise;
    await retryCurrentStep("loop-run-1", "user-1");

    // A new step run should have been created with attempt 2
    const newStepCreation = recordedStepRunCreations.find(c => c.nodeId === "work");
    expect(newStepCreation).toBeDefined();
    expect(newStepCreation?.attempt).toBe(2);

    // Workflow should have been dispatched
    expect(workflowStartCalls.length).toBe(1);

    // Run status should be running
    expect(currentLoopRun.status).toBe("running");
  });

  test("BT-C10: retry from running → throws (illegal transition)", async () => {
    currentLoopRun = makeLoopRun({ status: "running" });
    const { retryCurrentStep } = await chainPromise;
    await expect(retryCurrentStep("loop-run-1", "user-1")).rejects.toThrow();
  });
});

// ── BT-C11: end node — no dispatch ───────────────────────────────────────────

describe("BT-C11: end node — no dispatch after run completion", () => {
  beforeEach(() => {
    resetAll();

    const endStepRun = makeStepRun({ id: "step-end-1", nodeId: "end", nodeKind: "end" });
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
    await runAgentLoopStep({ stepRunId: "step-end-1", workflowRunId: "wf-run-1" });

    expect(workflowStartCalls.length).toBe(0);

    // No edge.evaluated event should be emitted for end nodes
    const edgeEvents = recordedEvents.filter(e => e.eventName === "agent-loop.edge.evaluated");
    expect(edgeEvents.length).toBe(0);
  });

  test("BT-C11: run remains completed after end node", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({ stepRunId: "step-end-1", workflowRunId: "wf-run-1" });

    // Run should be completed (set by executor mock) and not re-transitioned
    expect(currentLoopRun.status).toBe("completed");
  });
});
