/**
 * Agent Loops — PR #347 review-fix behavioral tests
 *
 * TDD RED: All findings from PR #347 coordinator review.
 *
 * CRITICAL — loop-back unique-index violation:
 *   BT-347-01: cycle walk — visiting same node twice must use attempt 2, not 1
 *              (Store mock enforces unique (loopRunId, nodeId, attempt) to expose the bug)
 *   BT-347-02: race/duplicate-advance — second concurrent call hits unique-violation →
 *              graceful skip with "duplicate_advance" event, no unhandled throw, one dispatch
 *   BT-347-03: retryCurrentStep produces attempt n+1 relative to highest existing attempt
 *
 * Nit 1 — silent return on snapshot re-parse failure:
 *   BT-347-04: when definitionSnapshot is unparseable, an agent-loop.chain.skipped event
 *              is recorded with reason "snapshot_invalid" before returning
 *
 * Nit 2 — guardrail trip leaves queued step run:
 *   BT-347-05: when guardrail trips, the current step run is updated to "skipped"
 *
 * Nit 3 — document dispatch-failure recovery gap (no behavior change, covered by comment
 *          assertions in the regression file)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Captured calls ─────────────────────────────────────────────────────────────

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
  errorKind?: string | null;
  errorMessage?: string | null;
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

// ── Store mock state ───────────────────────────────────────────────────────────

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

let advanceRunRowsUpdated = 1;
let priorStepRunCountForNode: Record<string, number> = {};
let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};

// Unique constraint store: Set of "loopRunId:nodeId:attempt"
// This simulates the real DB uniqueIndex on (loopRunId, nodeId, attempt).
let uniqueAttemptStore = new Set<string>();

// Whether the second createAgentLoopStepRun call should throw a unique violation
let createStepRunThrowsOnDuplicate = false;

let nextStepRunIdCounter = 400;
function nextId() {
  return `pr347-step-${nextStepRunIdCounter++}`;
}

// ── Executor mock state ────────────────────────────────────────────────────────

type ExecutorOutcome = {
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
};

let executorOutcomes: Record<string, ExecutorOutcome> = {};
let executedNodeIds: string[] = [];
let endNodeIds = new Set<string>(["end"]);

const executeAgentLoopStepMock = mock(
  async (params: {
    stepRunId: string;
    workflowRunId: string;
  }): Promise<ExecutorOutcome> => {
    const nodeId = stepRunIdToNodeId[params.stepRunId] ?? currentStepRun.nodeId;
    executedNodeIds.push(nodeId);

    if (endNodeIds.has(nodeId)) {
      currentLoopRun = { ...currentLoopRun, status: "completed" };
    }

    return executorOutcomes[nodeId] ?? { outcome: "success" };
  },
);

// ── Store mocks ────────────────────────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (stepRunId: string) => {
  const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
  return {
    stepRun,
    loopRun: currentLoopRun,
    loop: currentLoop,
  };
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
    const key = `${input.loopRunId}:${input.nodeId}:${attempt}`;

    // Enforce unique constraint when requested
    if (createStepRunThrowsOnDuplicate && uniqueAttemptStore.has(key)) {
      const err = new Error(
        `duplicate key value violates unique constraint "agent_loop_step_runs_run_node_attempt_idx"`,
      );
      // Attach a code property similar to pg errors
      (err as unknown as Record<string, unknown>)["code"] = "23505";
      throw err;
    }

    uniqueAttemptStore.add(key);

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

const updateAgentLoopStepRunMock = mock(
  async (input: StepRunUpdateInput): Promise<AgentLoopStepRun> => {
    recordedStepRunUpdates.push(input);
    const existing = stepRunIdToStepRun[input.stepRunId];
    const updated = existing
      ? {
          ...existing,
          ...(input.status !== undefined
            ? { status: input.status as AgentLoopStepRun["status"] }
            : {}),
        }
      : makeStepRun({ id: input.stepRunId });
    if (existing) stepRunIdToStepRun[input.stepRunId] = updated;
    return updated;
  },
);

const pauseLoopRunMock = mock(async (_runId: string, _userId: string) => {
  if (
    currentLoopRun.status !== "running" &&
    currentLoopRun.status !== "queued"
  ) {
    throw new Error(`Cannot pause run in status: ${currentLoopRun.status}`);
  }
  currentLoopRun = { ...currentLoopRun, status: "paused" };
  return currentLoopRun;
});

const cancelLoopRunMock = mock(async (_runId: string, _userId: string) => {
  const ok = new Set(["running", "queued", "paused"]);
  if (!ok.has(currentLoopRun.status))
    throw new Error(`Cannot cancel: ${currentLoopRun.status}`);
  currentLoopRun = { ...currentLoopRun, status: "cancelled" };
  return currentLoopRun;
});

const resumeLoopRunMock = mock(async (_runId: string, _userId: string) => {
  if (currentLoopRun.status !== "paused") throw new Error("Not paused");
  currentLoopRun = { ...currentLoopRun, status: "running" };
  return currentLoopRun;
});

const retryCurrentStepMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId } = params;
    if (
      currentLoopRun.status !== "failed" &&
      currentLoopRun.status !== "stalled"
    ) {
      throw new Error(`Cannot retry: ${currentLoopRun.status}`);
    }
    const failedStepRun = currentLoopRun.currentStepRunId
      ? stepRunIdToStepRun[currentLoopRun.currentStepRunId]
      : undefined;
    const nodeId =
      currentLoopRun.currentNodeId ?? failedStepRun?.nodeId ?? "work";
    const nodeKind = failedStepRun?.nodeKind ?? "agent_step";
    const nextAttempt = (failedStepRun?.attempt ?? 1) + 1;

    const id = nextId();
    recordedStepRunCreations.push({
      loopRunId: runId,
      nodeId,
      nodeKind,
      attempt: nextAttempt,
    });
    const newStepRun = makeStepRun({
      id,
      nodeId,
      nodeKind,
      attempt: nextAttempt,
      status: "queued",
    });
    stepRunIdToNodeId[id] = nodeId;
    stepRunIdToStepRun[id] = newStepRun;

    currentLoopRun = {
      ...currentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return newStepRun;
  },
);

// getAgentLoopRunWithLoop — for post-execution status re-check (no status flip in these tests)
const getAgentLoopRunWithLoopMock = mock(async (_runId: string) => ({
  run: currentLoopRun,
  loop: currentLoop,
}));

// getMaxAttemptForNode — returns countStepRunsForNode result as a proxy (same value in non-sparse tests)
const getMaxAttemptForNodeMock = mock(
  async (params: { loopRunId: string; nodeId: string }): Promise<number> => {
    const key = `${params.loopRunId}:${params.nodeId}`;
    return priorStepRunCountForNode[key] ?? 0;
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
  recordAgentLoopEvent: recordAgentLoopEventMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  advanceRunToNextStep: advanceRunToNextStepMock,
  countStepRunsForNode: countStepRunsForNodeMock,
  getMaxAttemptForNode: getMaxAttemptForNodeMock,
  updateAgentLoopStepRun: updateAgentLoopStepRunMock,
  pauseLoopRun: pauseLoopRunMock,
  cancelLoopRun: cancelLoopRunMock,
  resumeLoopRun: resumeLoopRunMock,
  retryCurrentStep: retryCurrentStepMock,
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
    return { runId: `wf-run-${nextStepRunIdCounter}` };
  },
);
mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

/**
 * 4-node cycle graph: start → work → condition → work (loop) → end
 *
 *   start → work → condition --[true]-→ end
 *                  condition --[false]→ work  (cycle back to work)
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
        condition: { path: "work.done", op: "eq", value: true },
      },
      { id: "end", kind: "end", label: "End", position: { x: 3, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "work", when: "success" },
      { id: "e2", source: "work", target: "condition", when: "success" },
      { id: "e3", source: "condition", target: "end", when: "true" },
      { id: "e4", source: "condition", target: "work", when: "false" }, // cycle back
    ],
  };
}

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  return {
    id: "loop-pr347",
    userId: "user-1",
    name: "PR347 Test Loop",
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
    id: "run-pr347",
    loopId: "loop-pr347",
    userId: "user-1",
    status: "running",
    definitionSnapshot: makeCycleDefinition() as Record<string, unknown>,
    currentNodeId: "work",
    currentStepRunId: "step-init-1",
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-pr347",
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
    id: "step-init-1",
    loopRunId: "run-pr347",
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

// ── Setup / reset ──────────────────────────────────────────────────────────────

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
  workflowStartThrows = null;
  uniqueAttemptStore = new Set();
  createStepRunThrowsOnDuplicate = false;
  nextStepRunIdCounter = 400;

  currentLoop = makeLoop();
  currentLoopRun = makeLoopRun();
  currentStepRun = makeStepRun({ id: "step-init-1", nodeId: "work" });
  stepRunIdToNodeId["step-init-1"] = "work";
  stepRunIdToStepRun["step-init-1"] = currentStepRun;

  getAgentLoopStepRunWithContextMock.mockClear();
  getAgentLoopRunWithLoopMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  recordAgentLoopEventMock.mockClear();
  createAgentLoopStepRunMock.mockClear();
  advanceRunToNextStepMock.mockClear();
  countStepRunsForNodeMock.mockClear();
  getMaxAttemptForNodeMock.mockClear();
  updateAgentLoopStepRunMock.mockClear();
  executeAgentLoopStepMock.mockClear();
  workflowStartMock.mockClear();
}

const chainPromise = import("./chain");
// retryCurrentStep moved to run-controls.ts; BT-347-03 now imports from there.
const runControlsPromise = import("./run-controls");

// ── BT-347-01: cycle-walk attempt increment ────────────────────────────────────

describe("BT-347-01: cycle revisit — second visit to same node must use attempt 2 (not 1)", () => {
  beforeEach(() => {
    resetAll();
    // We're at the condition node, returning "false" → cycle back to "work"
    // There's already 1 prior visit to "work" (it was executed once before)
    priorStepRunCountForNode["run-pr347:work"] = 1;

    // Register that (run-pr347, work, 1) is already taken
    uniqueAttemptStore.add("run-pr347:work:1");
    createStepRunThrowsOnDuplicate = true;

    const condStepRun = makeStepRun({
      id: "step-cond-1",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-cond-1"] = "condition";
    stepRunIdToStepRun["step-cond-1"] = condStepRun;
    currentStepRun = condStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-cond-1",
      stepCount: 2,
      iterationCount: 0,
    });

    executorOutcomes["condition"] = { outcome: "false" }; // loop back to work
  });

  test("BT-347-01: cycle back — createAgentLoopStepRun is called with attempt 2, not 1", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-1",
      workflowRunId: "wf-run-1",
    });

    // The step run created for "work" must have attempt 2 (priorVisits + 1 = 1 + 1 = 2)
    const workCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(workCreation).toBeDefined();
    expect(workCreation?.attempt).toBe(2);
  });

  test("BT-347-01: cycle back — dispatch still fires (no unique-violation error)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    // Must not throw despite duplicate-unique-key store being armed
    await expect(
      runAgentLoopStep({
        stepRunId: "step-cond-1",
        workflowRunId: "wf-run-1",
      }),
    ).resolves.toBeUndefined();

    // Dispatch must fire exactly once
    expect(workflowStartCalls.length).toBe(1);
  });

  test("BT-347-01: 3-step cycle — first visit attempt 1, second visit attempt 2, third visit attempt 3", async () => {
    // Reset and set up a clean cycle scenario without the unique store guard
    createStepRunThrowsOnDuplicate = false;
    // Simulate advancing through the cycle three times.
    // We test the attempt values passed to createAgentLoopStepRun.
    // Simulate: at condition step with 0 prior work visits → dispatch to work attempt 1
    priorStepRunCountForNode = { "run-pr347:work": 0 };

    const condStepRun1 = makeStepRun({
      id: "step-cond-a",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-cond-a"] = "condition";
    stepRunIdToStepRun["step-cond-a"] = condStepRun1;
    currentStepRun = condStepRun1;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-cond-a",
      stepCount: 2,
      iterationCount: 0,
    });
    executorOutcomes["condition"] = { outcome: "false" };

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-cond-a",
      workflowRunId: "wf-1",
    });

    // First dispatch to work: 0 prior visits → attempt 1
    const firstCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(firstCreation?.attempt).toBe(1);

    // Reset creations and simulate second cycle pass
    recordedStepRunCreations = [];
    workflowStartCalls = [];
    priorStepRunCountForNode["run-pr347:work"] = 1; // now 1 prior visit

    const condStepRun2 = makeStepRun({
      id: "step-cond-b",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-cond-b"] = "condition";
    stepRunIdToStepRun["step-cond-b"] = condStepRun2;
    currentStepRun = condStepRun2;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-cond-b",
      stepCount: 4,
      iterationCount: 1,
    });

    await runAgentLoopStep({
      stepRunId: "step-cond-b",
      workflowRunId: "wf-2",
    });

    // Second dispatch to work: 1 prior visit → attempt 2
    const secondCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(secondCreation?.attempt).toBe(2);

    // Third cycle
    recordedStepRunCreations = [];
    workflowStartCalls = [];
    priorStepRunCountForNode["run-pr347:work"] = 2;

    const condStepRun3 = makeStepRun({
      id: "step-cond-c",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-cond-c"] = "condition";
    stepRunIdToStepRun["step-cond-c"] = condStepRun3;
    currentStepRun = condStepRun3;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-cond-c",
      stepCount: 6,
      iterationCount: 2,
    });

    await runAgentLoopStep({
      stepRunId: "step-cond-c",
      workflowRunId: "wf-3",
    });

    const thirdCreation = recordedStepRunCreations.find(
      (c) => c.nodeId === "work",
    );
    expect(thirdCreation?.attempt).toBe(3);
  });
});

// ── BT-347-02: race / duplicate-advance unique-violation ──────────────────────

describe("BT-347-02: race condition — duplicate-advance unique violation → graceful skip, one dispatch", () => {
  beforeEach(() => {
    resetAll();

    // Two racing invocations for the same step would compute the same
    // (loopRunId, nodeId, attempt) and the second insert throws.
    // We arm the store to throw on the second attempt for "work":
    priorStepRunCountForNode["run-pr347:work"] = 0;
    createStepRunThrowsOnDuplicate = true;
    // Pre-populate with attempt 1 so the FIRST call succeeds but a
    // simulated second concurrent call would fail. We test by arming
    // the store to throw after the first successful insertion.

    const condStepRun = makeStepRun({
      id: "step-race-cond",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-race-cond"] = "condition";
    stepRunIdToStepRun["step-race-cond"] = condStepRun;
    currentStepRun = condStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-race-cond",
      stepCount: 2,
    });
    executorOutcomes["condition"] = { outcome: "false" };
  });

  test("BT-347-02: when createAgentLoopStepRun throws unique-constraint error, call is graceful (no unhandled throw)", async () => {
    // First call succeeds (work:attempt 1 not yet in store)
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-race-cond",
      workflowRunId: "wf-run-1",
    });

    // Simulate the second racing invocation: pre-arm the store so the next
    // call for the same (run, work, attempt=1) will throw.
    // Since the first call already put "run-pr347:work:1" in the store,
    // a second call with the same attempt will get a unique violation.
    //
    // Reset state for second concurrent invocation:
    recordedEvents = [];
    recordedAdvanceCalls = [];
    workflowStartCalls = [];
    recordedStepRunCreations = [];
    // Restore stepCount/conditions — second invocation sees same run state:
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-race-cond-2",
    });
    const condStepRun2 = makeStepRun({
      id: "step-race-cond-2",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-race-cond-2"] = "condition";
    stepRunIdToStepRun["step-race-cond-2"] = condStepRun2;
    // The work:1 slot is already taken from the first call
    // (uniqueAttemptStore has "run-pr347:work:1")

    // Second invocation must not throw
    await expect(
      runAgentLoopStep({
        stepRunId: "step-race-cond-2",
        workflowRunId: "wf-run-2",
      }),
    ).resolves.toBeUndefined();

    // Second invocation must emit a "skipped" event with reason "duplicate_advance"
    const skipEvent = recordedEvents.find(
      (e) =>
        e.eventName === "agent-loop.chain.skipped" &&
        (e.payload as Record<string, unknown> | undefined)?.["reason"] ===
          "duplicate_advance",
    );
    expect(skipEvent).toBeDefined();
  });

  test("BT-347-02: second racing call must not dispatch — exactly zero dispatches", async () => {
    // First call:
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-race-cond",
      workflowRunId: "wf-run-1",
    });
    const firstDispatchCount = workflowStartCalls.length;
    expect(firstDispatchCount).toBe(1); // first call succeeds

    // Second call (duplicate) — reset captures
    recordedEvents = [];
    workflowStartCalls = [];
    recordedStepRunCreations = [];
    recordedAdvanceCalls = [];

    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "condition",
      currentStepRunId: "step-race-cond-2",
    });
    const condStepRun2 = makeStepRun({
      id: "step-race-cond-2",
      nodeId: "condition",
      nodeKind: "condition",
    });
    stepRunIdToNodeId["step-race-cond-2"] = "condition";
    stepRunIdToStepRun["step-race-cond-2"] = condStepRun2;

    await runAgentLoopStep({
      stepRunId: "step-race-cond-2",
      workflowRunId: "wf-run-2",
    });

    // Second call must produce ZERO dispatches
    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── BT-347-03: retryCurrentStep produces attempt n+1 ─────────────────────────

describe("BT-347-03: retryCurrentStep always creates attempt n+1 relative to existing max", () => {
  beforeEach(() => {
    resetAll();
  });

  test("BT-347-03: retry after first failure — attempt 2", async () => {
    const failedStepRun = makeStepRun({
      id: "step-fail-1",
      nodeId: "work",
      nodeKind: "agent_step",
      attempt: 1,
      status: "failed",
    });
    stepRunIdToStepRun["step-fail-1"] = failedStepRun;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-fail-1",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-pr347", "user-1");

    const creation = recordedStepRunCreations.find((c) => c.nodeId === "work");
    expect(creation).toBeDefined();
    expect(creation?.attempt).toBe(2);
  });

  test("BT-347-03: retry after second failure — attempt 3", async () => {
    const failedStepRun = makeStepRun({
      id: "step-fail-2",
      nodeId: "work",
      nodeKind: "agent_step",
      attempt: 2,
      status: "failed",
    });
    stepRunIdToStepRun["step-fail-2"] = failedStepRun;
    currentLoopRun = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-fail-2",
    });

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-pr347", "user-1");

    const creation = recordedStepRunCreations.find((c) => c.nodeId === "work");
    expect(creation?.attempt).toBe(3);
  });
});

// ── BT-347-04: snapshot re-parse failure emits event ─────────────────────────

describe("BT-347-04: unparseable definitionSnapshot → skipped event with reason snapshot_invalid", () => {
  beforeEach(() => {
    resetAll();

    // A step run that has ALREADY been executed (post-execution, re-parse fails)
    const workStepRun = makeStepRun({
      id: "step-bad-snap",
      nodeId: "work",
      nodeKind: "agent_step",
    });
    stepRunIdToNodeId["step-bad-snap"] = "work";
    stepRunIdToStepRun["step-bad-snap"] = workStepRun;
    currentStepRun = workStepRun;

    // Break the definition snapshot so loopDefinitionSchema.safeParse fails
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-bad-snap",
      definitionSnapshot: {
        nodes: "not_an_array", // invalid — schema expects array
        edges: [],
      } as unknown as Record<string, unknown>,
    });

    executorOutcomes["work"] = { outcome: "success" };
  });

  test("BT-347-04: snapshot parse failure → agent-loop.chain.skipped event emitted (not silent return)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-bad-snap",
      workflowRunId: "wf-run-1",
    });

    // Must emit a skipped event — NOT silently return
    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent).toBeDefined();
  });

  test("BT-347-04: snapshot parse failure → skipped event has reason snapshot_invalid", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-bad-snap",
      workflowRunId: "wf-run-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    const payload = skipEvent?.payload as Record<string, unknown> | undefined;
    expect(payload?.["reason"]).toBe("snapshot_invalid");
  });

  test("BT-347-04: snapshot parse failure → skipped event has warn level", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-bad-snap",
      workflowRunId: "wf-run-1",
    });

    const skipEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skipEvent?.level).toBe("warn");
  });
});

// ── BT-347-05: guardrail trip marks current step run skipped ──────────────────

describe("BT-347-05: guardrail trip — current step run status set to skipped (not left queued)", () => {
  beforeEach(() => {
    resetAll();

    const guardStepRun = makeStepRun({
      id: "step-guard-pr347",
      nodeId: "work",
      nodeKind: "agent_step",
      status: "queued",
    });
    stepRunIdToNodeId["step-guard-pr347"] = "work";
    stepRunIdToStepRun["step-guard-pr347"] = guardStepRun;
    currentStepRun = guardStepRun;

    // stepCount at ceiling → guardrail trips
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-guard-pr347",
      stepCount: 50, // default ceiling
      startedAt: new Date(Date.now() - 60_000),
    });
    currentLoop = makeLoop({ guardrails: null });
  });

  test("BT-347-05: when guardrail trips, updateAgentLoopStepRun is called with status skipped", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-guard-pr347",
      workflowRunId: "wf-run-1",
    });

    // Guardrail must have tripped
    const tripped = recordedEvents.find(
      (e) => e.eventName === "agent-loop.guardrail.tripped",
    );
    expect(tripped).toBeDefined();

    // The current step run must be updated to "skipped"
    const stepSkip = recordedStepRunUpdates.find(
      (u) => u.stepRunId === "step-guard-pr347" && u.status === "skipped",
    );
    expect(stepSkip).toBeDefined();
  });

  test("BT-347-05: guardrail skipped step run has finishedAt set (timeline coherence)", async () => {
    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "step-guard-pr347",
      workflowRunId: "wf-run-1",
    });

    const stepSkip = recordedStepRunUpdates.find(
      (u) => u.stepRunId === "step-guard-pr347" && u.status === "skipped",
    );
    // finishedAt should be a Date (not undefined/null)
    expect(stepSkip?.finishedAt).toBeDefined();
    expect(stepSkip?.finishedAt).not.toBeNull();
  });
});
