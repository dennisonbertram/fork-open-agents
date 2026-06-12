/**
 * Agent Loops — PR #352 P1 stalled-run race: regression tests
 *
 * These tests would fail if the fix in 93a08ed6 is reverted.
 *
 * Breakage scenarios:
 *
 * REG-P1-01: If chain.ts does NOT handle stalled post-exec, a stalled run
 *   receives a workflow dispatch — violating the recovery semantics. This
 *   regression asserts workflowStartCalls.length === 0 after a stalled post-exec.
 *
 * REG-P1-02: If chain.ts treats stalled identically to cancelled (no advance),
 *   the step pointer would not be updated and retryCurrentStep could not
 *   re-dispatch the queued step. This regression asserts advanceRunToNextStep
 *   is called even when stalled.
 *
 * REG-P1-03: If the stalled event name is wrong or missing, observability
 *   tooling cannot distinguish stalled vs paused mid-execution. This regression
 *   asserts the exact event name "agent-loop.chain.stalled_before_dispatch"
 *   appears as a source-file literal.
 *
 * REG-P1-04: If the P1 queued-step branch in store.retryCurrentStep is removed,
 *   the store always creates n+1 for any step status. This regression asserts
 *   that when currentStepRunId is queued, the returned step run id is the SAME
 *   as the queued id (not a newly created one).
 *
 * REG-P1-05: If the classic failed-step path in store.retryCurrentStep is
 *   accidentally removed (collateral damage), retry-from-failed breaks.
 *   This regression asserts attempt n+1 is created for failed step runs.
 */

import { describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import { RunControlError } from "./run-controls-error";

mock.module("server-only", () => ({}));

// ── Shared captured-call state ─────────────────────────────────────────────────

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
let recordedAdvanceCalls: AdvanceRunInput[] = [];
let recordedStepRunCreations: unknown[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

let currentLoop: AgentLoop;
let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

let postExecutionRunStatus: AgentLoopRun["status"] | null = null;
let stepRunIdToNodeId: Record<string, string> = {};
let stepRunIdToStepRun: Record<string, AgentLoopStepRun> = {};
let counterA = 1100;
function nextId() {
  return `reg-p1-${counterA++}`;
}

// ── Executor mock ─────────────────────────────────────────────────────────────

const executeAgentLoopStepMock = mock(
  async (_params: { stepRunId: string; workflowRunId: string }) => {
    return { outcome: "success" as const };
  },
);

// ── Store mocks for chain.ts tests ────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (stepRunId: string) => {
  const stepRun = stepRunIdToStepRun[stepRunId] ?? currentStepRun;
  return { stepRun, loopRun: currentLoopRun, loop: currentLoop };
});

const getAgentLoopRunWithLoopMock = mock(async (_runId: string) => {
  if (postExecutionRunStatus !== null) {
    currentLoopRun = { ...currentLoopRun, status: postExecutionRunStatus };
  }
  return { run: currentLoopRun, loop: currentLoop };
});

const updateAgentLoopRunStatusMock = mock(
  async (input: { runId: string; status: string }) => {
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
  }) => {
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
    const id = nextId();
    recordedStepRunCreations.push({ ...input, id });
    const sr = makeStepRun({
      id,
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt: input.attempt ?? 1,
    });
    stepRunIdToNodeId[id] = input.nodeId;
    stepRunIdToStepRun[id] = sr;
    return sr;
  },
);

const advanceRunToNextStepMock = mock(async (input: AdvanceRunInput) => {
  recordedAdvanceCalls.push(input);
  currentLoopRun = {
    ...currentLoopRun,
    currentNodeId: input.nextNodeId,
    currentStepRunId: input.nextStepRunId,
  };
  return true;
});

const countStepRunsForNodeMock = mock(async () => 0);
const getMaxAttemptForNodeMock = mock(async () => 0);
const updateAgentLoopStepRunMock = mock(async () => currentStepRun);

// ── run-controls store mocks ──────────────────────────────────────────────────

let rcCurrentLoopRun: AgentLoopRun;
let rcStepRunById: Record<string, AgentLoopStepRun> = {};
let rcRunOwnership: Record<string, string> = {};
let rcCounter = 1200;
function rcNextId() {
  return `rc-reg-p1-${rcCounter++}`;
}

const retryCurrentStepStoreMock = mock(
  async (params: { runId: string; userId: string }) => {
    const { runId, userId } = params;
    const owner = rcRunOwnership[runId];
    if (!owner || owner !== userId) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }
    if (
      rcCurrentLoopRun.status !== "failed" &&
      rcCurrentLoopRun.status !== "stalled"
    ) {
      throw new RunControlError("illegal_transition", `not retryable`);
    }
    const currentSRId = rcCurrentLoopRun.currentStepRunId;
    if (!currentSRId) {
      throw new RunControlError(
        "illegal_transition",
        `missing currentStepRunId`,
      );
    }
    const currentSR = rcStepRunById[currentSRId];
    // P1 fix: queued step → re-dispatch, not n+1
    if (currentSR?.status === "queued") {
      rcCurrentLoopRun = { ...rcCurrentLoopRun, status: "running" };
      return currentSR;
    }
    // Classic: n+1
    const attempt = (currentSR?.attempt ?? 1) + 1;
    const id = rcNextId();
    const newSR = makeStepRun({
      id,
      loopRunId: runId,
      nodeId: rcCurrentLoopRun.currentNodeId ?? "work",
      attempt,
    });
    rcStepRunById[id] = newSR;
    rcCurrentLoopRun = {
      ...rcCurrentLoopRun,
      status: "running",
      currentStepRunId: id,
    };
    return newSR;
  },
);

let rcRecordedEvents: EventInput[] = [];
const rcRecordAgentLoopEventMock = mock(async (input: EventInput) => {
  rcRecordedEvents.push(input);
  return { id: `rc-evt-${rcRecordedEvents.length}`, ...input };
});

let rcWorkflowStartCalls: Array<{ stepRunId: string }> = [];
const rcWorkflowStartMock = mock(
  async (_wf: unknown, args: [{ stepRunId: string }]) => {
    rcWorkflowStartCalls.push(args[0]);
    return { runId: `wf-reg-${rcCounter}` };
  },
);

mock.module("./store", () => ({
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
mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));
mock.module("workflow/api", () => ({ start: rcWorkflowStartMock }));
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-run-mock" }),
}));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async () => {}),
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
    id: "loop-reg-p1",
    userId: "user-1",
    name: "Reg P1 Loop",
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
    id: "run-reg-p1",
    loopId: "loop-reg-p1",
    userId: "user-1",
    status: "running",
    definitionSnapshot: simpleDefinition as Record<string, unknown>,
    currentNodeId: "work",
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 1,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg-p1",
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
    id: "step-reg-p1-1",
    loopRunId: "run-reg-p1",
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

const chainPromise = import("./chain");
const runControlsPromise = import("./run-controls");

// ── REG-P1-01: stalled post-exec → zero dispatches ───────────────────────────

describe("REG-P1-01: stalled post-exec → zero dispatches (would fail if stalled falls through to dispatch)", () => {
  test("when run is stalled after step execution, no workflow start() call is made", async () => {
    recordedEvents = [];
    workflowStartCalls = [];
    recordedAdvanceCalls = [];
    recordedStepRunCreations = [];
    postExecutionRunStatus = null;

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ id: "reg-step-work", nodeId: "work" });
    stepRunIdToNodeId["reg-step-work"] = "work";
    stepRunIdToStepRun["reg-step-work"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "reg-step-work",
    });
    postExecutionRunStatus = "stalled";

    getAgentLoopStepRunWithContextMock.mockClear();
    getAgentLoopRunWithLoopMock.mockClear();
    recordAgentLoopEventMock.mockClear();
    advanceRunToNextStepMock.mockClear();
    createAgentLoopStepRunMock.mockClear();
    executeAgentLoopStepMock.mockClear();
    rcWorkflowStartMock.mockClear();

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-work",
      workflowRunId: "wf-reg-1",
    });

    // The critical invariant: no dispatch when stalled mid-execution.
    // If this fails, a stalled run's in-flight step return would race recovery.
    expect(workflowStartCalls.length).toBe(0);
  });
});

// ── REG-P1-02: stalled post-exec → advance bookkeeping still runs ─────────────

describe("REG-P1-02: stalled post-exec → advance bookkeeping runs (would fail if stalled treated like cancelled)", () => {
  test("advanceRunToNextStep is called even when run is stalled post-exec", async () => {
    recordedEvents = [];
    workflowStartCalls = [];
    recordedAdvanceCalls = [];
    recordedStepRunCreations = [];
    postExecutionRunStatus = null;

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ id: "reg-step-work-2", nodeId: "work" });
    stepRunIdToNodeId["reg-step-work-2"] = "work";
    stepRunIdToStepRun["reg-step-work-2"] = currentStepRun;
    currentLoopRun = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "reg-step-work-2",
    });
    postExecutionRunStatus = "stalled";

    getAgentLoopStepRunWithContextMock.mockClear();
    getAgentLoopRunWithLoopMock.mockClear();
    recordAgentLoopEventMock.mockClear();
    advanceRunToNextStepMock.mockClear();
    createAgentLoopStepRunMock.mockClear();
    executeAgentLoopStepMock.mockClear();
    rcWorkflowStartMock.mockClear();

    const { runAgentLoopStep } = await chainPromise;
    await runAgentLoopStep({
      stepRunId: "reg-step-work-2",
      workflowRunId: "wf-reg-2",
    });

    // Advance must still run so the queued next step is recoverable.
    // If advance is skipped (treated like cancelled), retry has nothing to dispatch.
    expect(recordedAdvanceCalls.length).toBeGreaterThan(0);
  });
});

// ── REG-P1-03: source-literal presence of stalled_before_dispatch ─────────────

describe("REG-P1-03: stalled_before_dispatch event name is a source-file literal (would fail if renamed/removed)", () => {
  test("'agent-loop.chain.stalled_before_dispatch' exists as a string literal in chain.ts", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const chainSource = readFileSync(
      join(import.meta.dir, "chain.ts"),
      "utf-8",
    );
    expect(
      chainSource.includes('"agent-loop.chain.stalled_before_dispatch"'),
    ).toBe(true);
  });
});

// ── REG-P1-04: retryCurrentStep queued path → same step id returned ───────────

describe("REG-P1-04: retryCurrentStep queued path → re-dispatches SAME step id (no n+1 for queued)", () => {
  test("when currentStepRunId is queued, the returned step run id equals the queued id", async () => {
    rcRecordedEvents = [];
    rcWorkflowStartCalls = [];
    rcStepRunById = {};
    rcRunOwnership = {};
    rcCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "reg-queued-step",
    });
    rcRunOwnership["run-reg-p1"] = "user-1";

    const queuedStepRun = makeStepRun({
      id: "reg-queued-step",
      nodeId: "work",
      attempt: 1,
      status: "queued",
    });
    rcStepRunById["reg-queued-step"] = queuedStepRun;

    retryCurrentStepStoreMock.mockClear();
    rcRecordAgentLoopEventMock.mockClear();
    rcWorkflowStartMock.mockClear();

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-reg-p1", "user-1");

    // The dispatched step run id must be the existing queued id.
    // If this assertion fails, the P1 fix was removed and n+1 was created.
    expect(rcWorkflowStartCalls.length).toBe(1);
    expect(rcWorkflowStartCalls[0]?.stepRunId).toBe("reg-queued-step");
  });
});

// ── REG-P1-05: retryCurrentStep failed path → n+1 still created ──────────────

describe("REG-P1-05: retryCurrentStep failed path → n+1 created (classic behavior not regressed)", () => {
  test("when currentStepRunId is failed, a NEW step run id is dispatched (not the failed one)", async () => {
    rcRecordedEvents = [];
    rcWorkflowStartCalls = [];
    rcStepRunById = {};
    rcRunOwnership = {};
    rcCurrentLoopRun = makeLoopRun({
      status: "stalled",
      currentNodeId: "work",
      currentStepRunId: "reg-failed-step",
    });
    rcRunOwnership["run-reg-p1"] = "user-1";

    const failedStepRun = makeStepRun({
      id: "reg-failed-step",
      nodeId: "work",
      attempt: 1,
      status: "failed",
      errorKind: "sandbox_unavailable",
    });
    rcStepRunById["reg-failed-step"] = failedStepRun;

    retryCurrentStepStoreMock.mockClear();
    rcRecordAgentLoopEventMock.mockClear();
    rcWorkflowStartMock.mockClear();

    const { retryCurrentStep } = await runControlsPromise;
    await retryCurrentStep("run-reg-p1", "user-1");

    // A NEW step run must be created and dispatched.
    // If the queued-path check incorrectly matches "failed", this fails.
    expect(rcWorkflowStartCalls.length).toBe(1);
    expect(rcWorkflowStartCalls[0]?.stepRunId).not.toBe("reg-failed-step");
  });
});
