/**
 * Agent Loops — definition-embedded guardrails honored at dispatch (#879)
 *
 * Reproduces the production bug: a loop's definitionSnapshot embeds
 * guardrails.maxAgentTurnsPerStep=24 (persisted via PATCH {definition:{...,
 * guardrails}}), but the chain.ts execution seam only reads the
 * agent_loops.guardrails COLUMN, so the step executor sees the 8-turn
 * default instead of the stored 24.
 *
 * Full seam: dispatchManualAgentLoopStart -> createAgentLoopRun
 * (definitionSnapshot) -> runAgentLoopStep -> executeAgentLoopStep params.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ── Fixture definition: minimal valid graph, real validateLoopDefinition must pass it ──

function makeDefinition(guardrails: Record<string, unknown> | undefined) {
  return {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "agent_step",
        kind: "agent_step",
        label: "Implement",
        position: { x: 1, y: 0 },
        instructions: "Do the work",
      },
      { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "agent_step", when: "success" },
      { id: "e2", source: "agent_step", target: "end", when: "success" },
    ],
    ...(guardrails !== undefined ? { guardrails } : {}),
  };
}

// ── Captured state ─────────────────────────────────────────────────────────────

let capturedDefinitionSnapshot: Record<string, unknown> | null = null;
let capturedExecutorParams: Array<{
  stepRunId: string;
  workflowRunId: string;
  maxAgentTurnsPerStep?: number;
}> = [];
let fixtureLoop: AgentLoop & {
  watchdogEnabled: boolean;
  watchdogInstructions: string | null;
  watchdogRetryBudget: number;
};

function makeLoop(
  overrides: Partial<AgentLoop> & { guardrails?: unknown } = {},
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
    repoName: "repo",
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
  } as AgentLoop & {
    watchdogEnabled: boolean;
    watchdogInstructions: string | null;
    watchdogRetryBudget: number;
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
    startedAt: null,
    completedAt: null,
    errorKind: null,
    errorMessage: null,
    output: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentLoopStepRun;
}

let currentLoopRun: AgentLoopRun;
let currentStepRun: AgentLoopStepRun;

// ── Store mock: capture createAgentLoopRun's definitionSnapshot input ──────────

mock.module("./store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  getOwnedAgentLoop: mock(
    async (_params: { userId: string; loopId: string }) => fixtureLoop,
  ),
  hasActiveRunForLoop: mock(async (_loopId: string) => null),
  createAgentLoopRun: mock(
    async (input: {
      loopId: string;
      userId: string;
      definitionSnapshot: Record<string, unknown>;
      source: string;
      idempotencyKey: string;
      triggerId: string | null;
      requestId: string | null;
      context: unknown;
    }) => {
      capturedDefinitionSnapshot = input.definitionSnapshot;
      currentLoopRun = {
        id: "loop-run-1",
        loopId: input.loopId,
        userId: input.userId,
        status: "queued",
        definitionSnapshot: input.definitionSnapshot,
        executionSnapshot: null,
        definitionVersion: null,
        definitionHash: null,
        currentNodeId: null,
        currentStepRunId: null,
        iterationCount: 0,
        stepCount: 0,
        context: {},
        source: input.source,
        startedAt: null,
        completedAt: null,
        errorKind: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AgentLoopRun;
      return { run: currentLoopRun, created: true };
    },
  ),
  createAgentLoopStepRun: mock(
    async (input: {
      loopRunId: string;
      nodeId: string;
      nodeKind: string;
      attempt?: number;
    }) => {
      currentStepRun = makeStepRun({
        id: "step-run-1",
        loopRunId: input.loopRunId,
        nodeId: input.nodeId,
        nodeKind: input.nodeKind,
        attempt: input.attempt ?? 1,
      });
      return currentStepRun;
    },
  ),
  setInitialStepPointer: mock(async () => undefined),
  recordAgentLoopEvent: mock(async (input: unknown) => ({
    id: "evt-1",
    ...(input as object),
  })),
  updateAgentLoopRunStatus: mock(
    async (input: { runId: string; status: string }) => {
      currentLoopRun = {
        ...currentLoopRun,
        status: input.status as AgentLoopRun["status"],
      };
      return currentLoopRun;
    },
  ),
  conditionallyTransitionRunStatus: mock(
    async (params: { runId: string; toStatus: AgentLoopRun["status"] }) => {
      currentLoopRun = { ...currentLoopRun, status: params.toStatus };
      return currentLoopRun;
    },
  ),
  advanceRunToNextStep: mock(async () => true),
  countStepRunsForNode: mock(async () => 0),
  getMaxAttemptForNode: mock(async () => 0),
  updateAgentLoopRunContext: mock(async () => undefined),
  getAgentLoopStepRunWithContext: mock(async (stepRunId: string) => ({
    stepRun: currentStepRun ?? makeStepRun({ id: stepRunId }),
    loopRun: currentLoopRun,
    loop: fixtureLoop,
  })),
  getAgentLoopRunWithLoop: mock(async (_runId: string) => ({
    run: currentLoopRun,
    loop: fixtureLoop,
  })),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
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
  updateAgentLoopStepRun: mock(async () => currentStepRun),
}));

mock.module("./watchdog", () => ({
  invokeWatchdog: mock(async () => ({ invoked: false, decision: "none" })),
}));

mock.module("./step-executor", () => ({
  executeAgentLoopStep: mock(
    async (params: {
      stepRunId: string;
      workflowRunId: string;
      maxAgentTurnsPerStep?: number;
    }) => {
      capturedExecutorParams.push(params);
      return { outcome: "success" };
    },
  ),
}));

mock.module("workflow/api", () => ({
  start: mock(async (_workflow: unknown, _args: [{ stepRunId: string }]) => {
    return { runId: "wf-1" };
  }),
}));

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wf-1" }),
}));

mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow: mock(async (_input: { stepRunId: string }) => {}),
}));

mock.module("./config", () => ({
  isAgentLoopsEnabled: () => true,
  getAgentLoopRepoAccess: () => ({ allowed: true }),
  isAgentLoopRepoAllowed: () => true,
}));

// Import modules under test AFTER mocks are registered.
const bridgePromise = import("./dispatcher-bridge");
const chainPromise = import("./chain");

beforeEach(() => {
  capturedDefinitionSnapshot = null;
  capturedExecutorParams = [];
});

describe("#879: definition-embedded guardrails honored at dispatch", () => {
  test("RED (production replay): manual dispatch + run honors embedded maxAgentTurnsPerStep=24", async () => {
    fixtureLoop = makeLoop({
      guardrails: null,
      definition: makeDefinition({ maxAgentTurnsPerStep: 24 }),
    });

    const { dispatchManualAgentLoopStart } = await bridgePromise;
    const { runAgentLoopStep } = await chainPromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
    });

    expect(result.created).toBe(true);
    expect(capturedDefinitionSnapshot?.guardrails).toEqual({
      maxAgentTurnsPerStep: 24,
    });

    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-1" });

    expect(capturedExecutorParams[0]?.maxAgentTurnsPerStep).toBe(24);
  });

  test("RED (per-field merge): column has an unrelated field, embedded 24 still honored", async () => {
    fixtureLoop = makeLoop({
      guardrails: { maxIterations: 5 },
      definition: makeDefinition({ maxAgentTurnsPerStep: 24 }),
    });

    const { dispatchManualAgentLoopStart } = await bridgePromise;
    const { runAgentLoopStep } = await chainPromise;

    await dispatchManualAgentLoopStart({ userId: "user-1", loopId: "loop-1" });
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-1" });

    expect(capturedExecutorParams[0]?.maxAgentTurnsPerStep).toBe(24);
  });

  test("pin (precedence): column wins per field over embedded value", async () => {
    fixtureLoop = makeLoop({
      guardrails: { maxAgentTurnsPerStep: 12 },
      definition: makeDefinition({ maxAgentTurnsPerStep: 24 }),
    });

    const { dispatchManualAgentLoopStart } = await bridgePromise;
    const { runAgentLoopStep } = await chainPromise;

    await dispatchManualAgentLoopStart({ userId: "user-1", loopId: "loop-1" });
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-1" });

    expect(capturedExecutorParams[0]?.maxAgentTurnsPerStep).toBe(12);
  });

  test("pin (malformed fallback): invalid embedded guardrails does not throw, falls back to default 8", async () => {
    fixtureLoop = makeLoop({
      guardrails: null,
      definition: makeDefinition({ maxAgentTurnsPerStep: "never" }),
    });

    const { dispatchManualAgentLoopStart } = await bridgePromise;
    const { runAgentLoopStep } = await chainPromise;

    await dispatchManualAgentLoopStart({ userId: "user-1", loopId: "loop-1" });
    await expect(
      runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-1" }),
    ).resolves.toBeUndefined();

    expect(capturedExecutorParams[0]?.maxAgentTurnsPerStep).toBe(8);
  });

  test("pin (ceiling): embedded value above the ceiling is clamped to 32", async () => {
    fixtureLoop = makeLoop({
      guardrails: null,
      definition: makeDefinition({ maxAgentTurnsPerStep: 500 }),
    });

    const { dispatchManualAgentLoopStart } = await bridgePromise;
    const { runAgentLoopStep } = await chainPromise;

    await dispatchManualAgentLoopStart({ userId: "user-1", loopId: "loop-1" });
    await runAgentLoopStep({ stepRunId: "step-run-1", workflowRunId: "wf-1" });

    expect(capturedExecutorParams[0]?.maxAgentTurnsPerStep).toBe(32);
  });
});
