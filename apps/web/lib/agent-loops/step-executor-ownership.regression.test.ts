import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import {
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
  toAgentLoopExecutionPolicy,
} from "./execution-snapshot";
import * as normalizedAdapter from "./normalized-step-input";

mock.module("server-only", () => ({}));

const agentNode = {
  id: "agent-1",
  kind: "agent_step" as const,
  label: "Implement",
  position: { x: 0, y: 0 },
  instructions: "Implement the accepted task",
};

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  const now = new Date("2026-07-12T12:00:00.000Z");
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Ownership regression",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: { nodes: [agentNode], edges: [] },
    status: "active",
    guardrails: null,
    permissions: { github: { issues: "write" } },
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRun(
  loop: AgentLoop,
  overrides: Partial<AgentLoopRun> = {},
): AgentLoopRun {
  const snapshot = buildAgentLoopExecutionSnapshot(loop);
  const now = new Date("2026-07-12T12:00:00.000Z");
  return {
    id: "run-1",
    loopId: loop.id,
    userId: loop.userId,
    status: "running",
    definitionSnapshot: snapshot.definition,
    executionSnapshot: snapshot,
    definitionVersion: 1,
    definitionHash: hashAgentLoopExecutionSnapshot(snapshot),
    currentNodeId: agentNode.id,
    currentStepRunId: "step-1",
    iterationCount: 0,
    stepCount: 1,
    context: { prior: { branch: "codex/persisted-branch" } },
    source: "manual",
    triggerId: null,
    idempotencyKey: "manual:ownership",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "workflow-1",
    requestId: "request-1",
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStep(overrides: Partial<AgentLoopStepRun> = {}): AgentLoopStepRun {
  const now = new Date("2026-07-12T12:00:00.000Z");
  return {
    id: "step-1",
    loopRunId: "run-1",
    nodeId: agentNode.id,
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
    createdAt: now,
    ...overrides,
  };
}

let currentLoop = makeLoop();
let currentRun = makeRun(currentLoop);
let currentStep = makeStep();
let claimWins = true;
let durableRunningClaimHeld = false;
let updateCalls: Array<Record<string, unknown>> = [];
let eventCalls: Array<Record<string, unknown>> = [];

const getContextMock = mock(async () => {
  const resolved = toAgentLoopExecutionPolicy(currentRun, currentLoop);
  return {
    stepRun: currentStep,
    loopRun: currentRun,
    ...resolved,
    liveSource: normalizedAdapter.projectAgentLoopLiveSource(
      currentLoop,
      currentStep.nodeId,
    ),
  };
});

const updateStepMock = mock(async (input: Record<string, unknown>) => {
  updateCalls.push(input);
  if (input.expectedStatuses && !claimWins) return null;
  if (input.executionClaimGeneration) {
    if (
      durableRunningClaimHeld ||
      (currentStep.stepInput as Record<string, unknown> | null)
        ?.executionClaimGeneration
    ) {
      return null;
    }
    durableRunningClaimHeld = true;
  }
  return { ...currentStep, ...input } as AgentLoopStepRun;
});

const recordEventMock = mock(async (input: Record<string, unknown>) => {
  eventCalls.push(input);
  return input;
});

mock.module("./store", () => ({
  getAgentLoopStepRunWithContext: getContextMock,
  updateAgentLoopStepRun: updateStepMock,
  recordAgentLoopEvent: recordEventMock,
  conditionallyTransitionRunStatus: mock(async () => null),
  updateAgentLoopRunContext: mock(async () => currentRun),
}));

let normalizedBuildCount = 0;
const realBuildAgentLoopNormalizedStepInput =
  normalizedAdapter.buildAgentLoopNormalizedStepInput;
const buildNormalizedMock = mock(
  (
    input: Parameters<
      typeof normalizedAdapter.buildAgentLoopNormalizedStepInput
    >[0],
  ) => {
    normalizedBuildCount += 1;
    return realBuildAgentLoopNormalizedStepInput(input);
  },
);

mock.module("./normalized-step-input", () => ({
  ...normalizedAdapter,
  buildAgentLoopNormalizedStepInput: buildNormalizedMock,
}));

const verifyRepoAccessMock = mock(async () => ({
  ok: true as const,
  installationId: 42,
  repositoryId: 7,
  defaultBranch: "main",
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessMock,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mock(async () => ({ token: "unused" })),
  revokeInstallationToken: mock(async () => undefined),
}));

let tokenSideEffects = 0;
let sandboxSideEffects = 0;
let commitSideEffects = 0;
let executionGate: Promise<void> = Promise.resolve();
let releaseExecutions: (() => void) | null = null;
let enteredExecutions = 0;

const executeAgentStepMock = mock(async (_params?: Record<string, unknown>) => {
  tokenSideEffects += 1;
  sandboxSideEffects += 1;
  enteredExecutions += 1;
  await executionGate;
  commitSideEffects += 1;
  return { outcome: "success" as const };
});

mock.module("./agent-step", () => ({
  executeAgentStep: executeAgentStepMock,
}));

const executorPromise = import("./step-executor");

beforeEach(() => {
  currentLoop = makeLoop();
  currentRun = makeRun(currentLoop);
  currentStep = makeStep();
  claimWins = true;
  durableRunningClaimHeld = false;
  updateCalls = [];
  eventCalls = [];
  normalizedBuildCount = 0;
  tokenSideEffects = 0;
  sandboxSideEffects = 0;
  commitSideEffects = 0;
  executionGate = new Promise<void>((resolve) => {
    releaseExecutions = resolve;
  });
  enteredExecutions = 0;
  getContextMock.mockClear();
  updateStepMock.mockClear();
  recordEventMock.mockClear();
  buildNormalizedMock.mockClear();
  verifyRepoAccessMock.mockClear();
  executeAgentStepMock.mockClear();
});

describe("agent-loop step ownership regressions", () => {
  test("invalid normalized input with a persisted branch performs no credentialed repo access", async () => {
    currentRun = makeRun(currentLoop, {
      context: {
        prior: { branch: "codex/persisted-branch" },
        trigger: { token: "PRIVATE-CONTEXT-CANARY" },
      },
    });

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-invalid",
    });

    expect(result).toMatchObject({
      outcome: "failure",
      errorKind: "normalized_input_invalid",
    });
    expect(verifyRepoAccessMock).not.toHaveBeenCalled();
    expect(executeAgentStepMock).not.toHaveBeenCalled();
  });

  test("invalid normalized input without a persisted branch performs no credentialed repo access", async () => {
    currentRun = makeRun(currentLoop, {
      context: {
        trigger: { token: "PRIVATE-CONTEXT-CANARY" },
      },
    });

    const { executeAgentLoopStep } = await executorPromise;
    const result = await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-invalid-no-branch",
    });

    expect(result).toMatchObject({
      outcome: "failure",
      errorKind: "normalized_input_invalid",
    });
    expect(verifyRepoAccessMock).not.toHaveBeenCalled();
    expect(executeAgentStepMock).not.toHaveBeenCalled();
  });

  test("queued claim uses expectedStatuses and losing it replays safely", async () => {
    claimWins = false;
    const { executeAgentLoopStep } = await executorPromise;

    const result = await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-claim-loser",
    });

    expect(result).toEqual({
      outcome: "replay",
      errorKind: "step_ownership_lost",
    });
    expect(updateCalls[0]).toMatchObject({
      stepRunId: currentStep.id,
      status: "running",
      workflowRunId: "workflow-claim-loser",
      expectedStatuses: ["queued"],
    });
    expect(eventCalls).toEqual([]);
    expect(buildNormalizedMock).not.toHaveBeenCalled();
  });

  test("running step owned by another workflow replays safely", async () => {
    currentStep = makeStep({
      status: "running",
      workflowRunId: "workflow-owner",
      stepInput: { executionClaimGeneration: "existing-claim" },
    });
    const { executeAgentLoopStep } = await executorPromise;

    const result = await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-replay",
    });

    expect(result).toEqual({
      outcome: "replay",
      errorKind: "step_ownership_lost",
    });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        expectedStatuses: ["running"],
        expectedExecutionClaimGeneration: null,
        workflowRunId: "workflow-replay",
      }),
    );
    expect(eventCalls).toEqual([]);
    expect(buildNormalizedMock).not.toHaveBeenCalled();
  });

  test("overlapping deliveries with the same workflow own one normalized execution", async () => {
    currentStep = makeStep({
      status: "running",
      workflowRunId: "workflow-owner",
    });
    const { executeAgentLoopStep } = await executorPromise;

    const first = executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-owner",
    });
    const second = executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-owner",
    });

    for (let index = 0; index < 20 && enteredExecutions < 2; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseExecutions?.();
    await Promise.all([first, second]);

    expect(normalizedBuildCount).toBe(1);
    expect(tokenSideEffects).toBe(1);
    expect(sandboxSideEffects).toBe(1);
    expect(commitSideEffects).toBe(1);
  });

  test("running execution acquires a durable claim generation before side effects", async () => {
    currentStep = makeStep({
      status: "running",
      workflowRunId: "workflow-owner",
    });
    executionGate = Promise.resolve();
    const { executeAgentLoopStep } = await executorPromise;

    await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-owner",
    });

    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        stepRunId: currentStep.id,
        expectedStatuses: ["running"],
        workflowRunId: "workflow-owner",
        executionClaimGeneration: expect.any(String),
      }),
    );
    expect(executeAgentStepMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        executionClaimGeneration: expect.any(String),
      }),
    );
  });

  test("stale workflow correlation without a claim can be adopted safely", async () => {
    currentStep = makeStep({
      status: "running",
      workflowRunId: "workflow-stale",
    });
    executionGate = Promise.resolve();
    const { executeAgentLoopStep } = await executorPromise;

    const result = await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-current",
    });

    expect(result).toEqual({ outcome: "success" });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        expectedStatuses: ["running"],
        expectedExecutionClaimGeneration: null,
        workflowRunId: "workflow-current",
        executionClaimGeneration: expect.any(String),
      }),
    );
    expect(executeAgentStepMock).toHaveBeenCalledTimes(1);
  });

  test("separate-worker replay after the local guard clears owns no second side-effect path", async () => {
    currentStep = makeStep({
      status: "running",
      workflowRunId: "workflow-owner",
    });
    executionGate = Promise.resolve();
    const { executeAgentLoopStep } = await executorPromise;

    await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-owner",
    });
    // The wrapper's module-local Set is now empty. A second worker/process has
    // the same effective view, so only durable claim state can reject replay.
    await executeAgentLoopStep({
      stepRunId: currentStep.id,
      workflowRunId: "workflow-owner",
    });

    expect(normalizedBuildCount).toBe(1);
    expect(tokenSideEffects).toBe(1);
    expect(sandboxSideEffects).toBe(1);
    expect(commitSideEffects).toBe(1);
  });
});
