/**
 * Agent Loops — chain.ts race fix tests (M1-10)
 *
 * Reproduces the cancel-after-load race defect found in PR #351 smoke:
 * A run is queued; the step workflow loads it (status=queued); the user
 * cancels the run; the chain's queued→running transition (step 3) attempts
 * an unconditional updateAgentLoopRunStatus → this overwrites the cancelled
 * status, causing a noisy error and incorrect state.
 *
 * Fix: make the transition CONDITIONAL — only transition when current status
 * is queued (conditional WHERE similar to advanceRunToNextStep). If 0 rows
 * updated (status changed underneath), treat as the cooperative-skip path.
 *
 * BT-RACE01: cancel-after-load → step NOT executed, chain.skipped emitted, no throw
 * BT-RACE02: normal path (no cancel race) → queued→running still fires correctly
 * BT-RACE03: already-running (not queued on load) still proceeds correctly
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

let recordedEvents: EventInput[] = [];
let recordedRunStatusUpdates: RunStatusInput[] = [];
let executedStepRunIds: string[] = [];
let workflowStartCalls: Array<{ stepRunId: string }> = [];

// ── Mock state ────────────────────────────────────────────────────────────────

// The loop run loaded at the start of runAgentLoopStep
let loadedLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;
let currentStepRun: AgentLoopStepRun;

// Controls whether the conditional queued→running transition succeeds or is
// a no-op (null = 0 rows = status changed underneath, e.g. cancelled).
let conditionalTransitionReturns: AgentLoopRun | null = null;

// What getAgentLoopRunWithLoop returns AFTER execution (post-exec re-check)
let postExecLoopRun: AgentLoopRun;

// Track calls to conditionallyTransitionRunStatus
let conditionalTransitionCalls: Array<{
  runId: string;
  toStatus: string;
  fromStatuses: string[];
}> = [];

const simpleDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
    { id: "end", kind: "end", label: "E", position: { x: 1, y: 0 } },
  ],
  edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
};

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-race-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "queued",
    definitionSnapshot: simpleDefinition as Record<string, unknown>,
    currentNodeId: "start",
    currentStepRunId: "step-1",
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

function makeLoop(): AgentLoop {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Race Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: simpleDefinition as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-1",
    loopRunId: "run-race-1",
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

// ── Store mocks ───────────────────────────────────────────────────────────────

const getAgentLoopStepRunWithContextMock = mock(async (_stepRunId: string) => ({
  stepRun: currentStepRun,
  loopRun: loadedLoopRun,
  loop: currentLoop,
}));

// The CONDITIONAL version of updateAgentLoopRunStatus (non-conditional calls)
const updateAgentLoopRunStatusMock = mock(
  async (input: RunStatusInput): Promise<AgentLoopRun | null> => {
    recordedRunStatusUpdates.push(input);
    return { ...loadedLoopRun, status: input.status as AgentLoopRun["status"] };
  },
);

// conditionallyTransitionRunStatus — returns null to simulate cancel race
const conditionallyTransitionRunStatusMock = mock(
  async (params: {
    runId: string;
    toStatus: AgentLoopRun["status"];
    fromStatuses: AgentLoopRun["status"][];
    errorKind?: string | null;
    errorMessage?: string | null;
  }): Promise<AgentLoopRun | null> => {
    conditionalTransitionCalls.push({
      runId: params.runId,
      toStatus: params.toStatus,
      fromStatuses: params.fromStatuses,
    });
    return conditionalTransitionReturns;
  },
);

const recordAgentLoopEventMock = mock(async (input: EventInput) => {
  recordedEvents.push(input);
  return {
    id: `evt-${recordedEvents.length}`,
    ...input,
    createdAt: new Date(),
  };
});

// After execution, getAgentLoopRunWithLoop is called for post-exec re-check
const getAgentLoopRunWithLoopMock = mock(async (_runId: string) => ({
  run: postExecLoopRun,
  loop: currentLoop,
}));

const advanceRunToNextStepMock = mock(async () => true);
const countStepRunsForNodeMock = mock(async () => 0);
const getMaxAttemptForNodeMock = mock(async () => 0);
const createAgentLoopStepRunMock = mock(
  async (input: {
    loopRunId: string;
    nodeId: string;
    nodeKind: string;
    attempt: number;
  }) => ({
    id: "step-next-1",
    loopRunId: input.loopRunId,
    nodeId: input.nodeId,
    nodeKind: input.nodeKind,
    attempt: input.attempt,
    status: "queued" as const,
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
  }),
);
const updateAgentLoopStepRunMock = mock(async () => currentStepRun);

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
      const advanced = await advanceRunToNextStepMock();
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

// Executor mock — records which step runs were executed
const executeAgentLoopStepMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }) => {
    executedStepRunIds.push(params.stepRunId);
    return { outcome: "success" as const };
  },
);
mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));

// workflow/api mock
const workflowStartMock = mock(
  async (_workflow: unknown, args: [{ stepRunId: string }]) => {
    workflowStartCalls.push(args[0]);
    return { runId: "wf-race-1" };
  },
);
mock.module("workflow/api", () => ({
  start: workflowStartMock,
}));

mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

const chainModulePromise = import("./chain");

describe("BT-RACE01: cancel-after-load race — conditional queued→running transition", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedRunStatusUpdates = [];
    conditionalTransitionCalls = [];
    executedStepRunIds = [];
    workflowStartCalls = [];

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ nodeId: "start", nodeKind: "start" });
    // The run is loaded as queued...
    loadedLoopRun = makeLoopRun({ status: "queued" });
    // ...but a cancel happened underneath, so the conditional transition returns null
    conditionalTransitionReturns = null;
    // Post-exec run status (for the non-race path this would be "running")
    postExecLoopRun = makeLoopRun({ status: "running" });

    getAgentLoopStepRunWithContextMock.mockImplementation(
      async (_stepRunId: string) => ({
        stepRun: currentStepRun,
        loopRun: loadedLoopRun,
        loop: currentLoop,
      }),
    );
    conditionallyTransitionRunStatusMock.mockImplementation(async (params) => {
      conditionalTransitionCalls.push({
        runId: params.runId,
        toStatus: params.toStatus,
        fromStatuses: params.fromStatuses,
      });
      return conditionalTransitionReturns;
    });
    updateAgentLoopRunStatusMock.mockImplementation(
      async (input: RunStatusInput): Promise<AgentLoopRun | null> => {
        recordedRunStatusUpdates.push(input);
        return {
          ...loadedLoopRun,
          status: input.status as AgentLoopRun["status"],
        };
      },
    );
  });

  test("BT-RACE01a: step is NOT executed when conditional transition returns null (cancel race)", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // The step executor must NOT have been called
    expect(executedStepRunIds).toHaveLength(0);
  });

  test("BT-RACE01b: chain.skipped event emitted when conditional transition is a no-op", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    const skippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skippedEvent).toBeDefined();
    expect(skippedEvent?.loopRunId).toBe("run-race-1");
  });

  test("BT-RACE01c: no workflow dispatch when conditional transition is a no-op", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    expect(workflowStartCalls).toHaveLength(0);
  });

  test("BT-RACE01d: runAgentLoopStep does not throw when conditional transition is a no-op", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    // Must not throw — the server log must be clean
    await expect(
      runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("BT-RACE02: normal path (no cancel race) — queued→running still fires", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedRunStatusUpdates = [];
    conditionalTransitionCalls = [];
    executedStepRunIds = [];
    workflowStartCalls = [];

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ nodeId: "start", nodeKind: "start" });
    loadedLoopRun = makeLoopRun({ status: "queued" });
    // Conditional transition succeeds (returns the run)
    conditionalTransitionReturns = makeLoopRun({ status: "running" });
    // Post-exec run is running
    postExecLoopRun = makeLoopRun({ status: "running" });

    getAgentLoopStepRunWithContextMock.mockImplementation(
      async (_stepRunId: string) => ({
        stepRun: currentStepRun,
        loopRun: loadedLoopRun,
        loop: currentLoop,
      }),
    );
    conditionallyTransitionRunStatusMock.mockImplementation(async (params) => {
      conditionalTransitionCalls.push({
        runId: params.runId,
        toStatus: params.toStatus,
        fromStatuses: params.fromStatuses,
      });
      return conditionalTransitionReturns;
    });
    updateAgentLoopRunStatusMock.mockImplementation(
      async (input: RunStatusInput): Promise<AgentLoopRun | null> => {
        recordedRunStatusUpdates.push(input);
        return {
          ...loadedLoopRun,
          status: input.status as AgentLoopRun["status"],
        };
      },
    );
  });

  test("BT-RACE02: step IS executed when conditional transition succeeds", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // Executor should have been called (start node + normal flow)
    expect(executedStepRunIds).toContain("step-1");
  });

  test("BT-RACE02b: run.started event fired on successful queued→running", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    const startedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.run.started",
    );
    expect(startedEvent).toBeDefined();
  });
});

describe("BT-RACE03: already-running run still proceeds (no conditional transition needed)", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedRunStatusUpdates = [];
    conditionalTransitionCalls = [];
    executedStepRunIds = [];
    workflowStartCalls = [];

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ nodeId: "start", nodeKind: "start" });
    // Already running — no queued→running transition needed
    loadedLoopRun = makeLoopRun({ status: "running", startedAt: new Date() });
    conditionalTransitionReturns = null; // won't be used (no transition for already-running)
    postExecLoopRun = makeLoopRun({ status: "running", startedAt: new Date() });

    getAgentLoopStepRunWithContextMock.mockImplementation(
      async (_stepRunId: string) => ({
        stepRun: currentStepRun,
        loopRun: loadedLoopRun,
        loop: currentLoop,
      }),
    );
  });

  test("BT-RACE03: already-running run proceeds to execute step without conditional transition", async () => {
    const { runAgentLoopStep } = await chainModulePromise;

    await runAgentLoopStep({ stepRunId: "step-1", workflowRunId: "wf-1" });

    // Step should have been executed
    expect(executedStepRunIds).toContain("step-1");
    // No conditional transition (run was already running, not queued)
    const toRunningTransitions = conditionalTransitionCalls.filter(
      (u) => u.toStatus === "running",
    );
    expect(toRunningTransitions).toHaveLength(0);
  });
});
