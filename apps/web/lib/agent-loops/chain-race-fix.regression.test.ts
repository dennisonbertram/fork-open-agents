/**
 * Agent Loops — chain race fix regression tests (M1-10)
 *
 * Catches future reversion of the conditional queued→running transition.
 *
 * REG-RACE-01: If the conditional transition is removed (reverted to unconditional),
 *   the chain would proceed even when a cancel happened between load and execution.
 *   This test verifies the step is NOT executed when the transition returns null.
 *
 * REG-RACE-02: The chain.skipped event payload includes the reason field.
 *   Removing the reason would break observability tooling that filters by it.
 *
 * REG-RACE-03: Already-running runs must NOT call conditionallyTransitionRunStatus.
 *   If the check is removed (transition always called), this test fails.
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
let conditionalTransitionCalls: Array<{
  runId: string;
  toStatus: string;
  fromStatuses: string[];
}> = [];

let loadedLoopRun: AgentLoopRun;
let currentLoop: AgentLoop;
let currentStepRun: AgentLoopStepRun;
let conditionalTransitionReturns: AgentLoopRun | null = null;
let postExecLoopRun: AgentLoopRun;

const simpleDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
    { id: "end", kind: "end", label: "E", position: { x: 1, y: 0 } },
  ],
  edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
};

function makeLoopRun(overrides: Partial<AgentLoopRun> = {}): AgentLoopRun {
  return {
    id: "run-reg-1",
    loopId: "loop-reg-1",
    userId: "user-1",
    status: "queued",
    definitionSnapshot: simpleDefinition as Record<string, unknown>,
    currentNodeId: "start",
    currentStepRunId: "step-reg-1",
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-reg-1",
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
    id: "loop-reg-1",
    userId: "user-1",
    name: "Reg Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: simpleDefinition as Record<string, unknown>,
    status: "active",
    guardrails: null,
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStepRun(
  overrides: Partial<AgentLoopStepRun> = {},
): AgentLoopStepRun {
  return {
    id: "step-reg-1",
    loopRunId: "run-reg-1",
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

const getAgentLoopStepRunWithContextMock = mock(async (_stepRunId: string) => ({
  stepRun: currentStepRun,
  loopRun: loadedLoopRun,
  loop: currentLoop,
}));

const updateAgentLoopRunStatusMock = mock(
  async (input: RunStatusInput): Promise<AgentLoopRun | null> => {
    recordedRunStatusUpdates.push(input);
    return { ...loadedLoopRun, status: input.status as AgentLoopRun["status"] };
  },
);

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
    id: "step-next-reg-1",
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
}));

const executeAgentLoopStepMock = mock(
  async (params: { stepRunId: string; workflowRunId: string }) => {
    executedStepRunIds.push(params.stepRunId);
    return { outcome: "success" as const };
  },
);
mock.module("./step-executor", () => ({
  executeAgentLoopStep: executeAgentLoopStepMock,
}));

const workflowStartMock = mock(
  async (_workflow: unknown, _args: [{ stepRunId: string }]) => {
    return { runId: "wf-reg-1" };
  },
);
mock.module("workflow/api", () => ({ start: workflowStartMock }));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

const chainModulePromise = import("./chain");

describe("chain race fix regression tests — breakage detection", () => {
  beforeEach(() => {
    recordedEvents = [];
    recordedRunStatusUpdates = [];
    conditionalTransitionCalls = [];
    executedStepRunIds = [];

    currentLoop = makeLoop();
    currentStepRun = makeStepRun({ nodeId: "start", nodeKind: "start" });
    loadedLoopRun = makeLoopRun({ status: "queued" });
    conditionalTransitionReturns = null; // default: cancel race
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
    getAgentLoopRunWithLoopMock.mockImplementation(async () => ({
      run: postExecLoopRun,
      loop: currentLoop,
    }));
    advanceRunToNextStepMock.mockImplementation(async () => true);
    executeAgentLoopStepMock.mockImplementation(
      async (params: { stepRunId: string; workflowRunId: string }) => {
        executedStepRunIds.push(params.stepRunId);
        return { outcome: "success" as const };
      },
    );
    workflowStartMock.mockClear();
  });

  test("REG-RACE-01: step NOT executed when conditional transition returns null (revert detection)", async () => {
    // If the conditional check is removed and execution proceeds unconditionally,
    // executedStepRunIds will be non-empty and this test fails.
    const { runAgentLoopStep } = await chainModulePromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-1",
      workflowRunId: "wf-reg-1",
    });

    // Conditional transition was called with the right args
    expect(conditionallyTransitionRunStatusMock).toHaveBeenCalled();
    // Step must NOT have been executed
    expect(executedStepRunIds).toHaveLength(0);
  });

  test("REG-RACE-02: chain.skipped payload includes reason field", async () => {
    // If the reason field is removed from the payload, observability tooling
    // that filters `chain.skipped` by reason will stop working.
    const { runAgentLoopStep } = await chainModulePromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-1",
      workflowRunId: "wf-reg-1",
    });

    const skippedEvent = recordedEvents.find(
      (e) => e.eventName === "agent-loop.chain.skipped",
    );
    expect(skippedEvent).toBeDefined();
    const payload = skippedEvent?.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload?.reason).toBeDefined();
    expect(typeof payload?.reason).toBe("string");
  });

  test("REG-RACE-03: already-running run does NOT call conditionallyTransitionRunStatus", async () => {
    // If the status check before the conditional transition is removed,
    // already-running runs would hit the conditional path unnecessarily,
    // causing spurious 0-rows-updated skips.
    loadedLoopRun = makeLoopRun({ status: "running", startedAt: new Date() });
    conditionalTransitionReturns = null; // would cause skip if incorrectly triggered
    postExecLoopRun = makeLoopRun({ status: "running", startedAt: new Date() });

    getAgentLoopStepRunWithContextMock.mockImplementation(async () => ({
      stepRun: currentStepRun,
      loopRun: loadedLoopRun,
      loop: currentLoop,
    }));

    const { runAgentLoopStep } = await chainModulePromise;
    await runAgentLoopStep({
      stepRunId: "step-reg-1",
      workflowRunId: "wf-reg-1",
    });

    // No conditional queued→running transition for already-running
    const toRunningCalls = conditionalTransitionCalls.filter(
      (c) => c.toStatus === "running",
    );
    expect(toRunningCalls).toHaveLength(0);
    // Step should have been executed (not skipped)
    expect(executedStepRunIds).toContain("step-reg-1");
  });
});
