/**
 * REGRESSION tests: "loop dispatch gate order and loopRunIds surfacing".
 *
 * These tests would FAIL if the implementation in feat: TASK-326 (57ef81d0) is reverted.
 *
 * Regression scenarios covered:
 * - REGRESSION-326-001: single-active-run rule prevents double dispatch
 * - REGRESSION-326-002: feature-disabled gate blocks manual start even with valid ownership
 * - REGRESSION-326-003: skipped dispatch does not leak a runId into the caller's result
 * - REGRESSION-326-004: dispatchManualAgentLoopStart active_run check fires before createAgentLoopRun
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Store mocks ────────────────────────────────────────────────────────────────

let hasActiveRunResult = false;
let createRunCallCount = 0;

const createAgentLoopRun = mock(async () => {
  createRunCallCount++;
  return {
    run: { id: `loop-run-${createRunCallCount}`, status: "queued" },
    created: true,
  };
});
const hasActiveRunForLoop = mock(async () => hasActiveRunResult);
const getOwnedAgentLoop = mock(async () => ({
  id: "loop-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: {
    nodes: [
      {
        id: "start-node",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      { id: "end-node", kind: "end", label: "End", position: { x: 100, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start-node", target: "end-node", when: "always" },
    ],
  } as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "My Loop",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const createAgentLoopStepRun = mock(async () => ({
  id: "step-run-1",
  loopRunId: "loop-run-1",
  nodeId: "start-node",
  nodeKind: "start",
  attempt: 1,
  status: "queued",
  createdAt: new Date(),
  updatedAt: new Date(),
}));
const updateAgentLoopRunStatus = mock(async () => null);
const recordAgentLoopEvent = mock(async () => ({
  id: "event-1",
  loopRunId: "loop-run-1",
  eventName: "test",
  status: "info" as const,
  level: "info" as const,
  createdAt: new Date(),
}));

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoopRun,
  hasActiveRunForLoop,
  getOwnedAgentLoop,
  createAgentLoopStepRun,
  updateAgentLoopRunStatus,
  recordAgentLoopEvent,
}));

// ── Workflow mock ─────────────────────────────────────────────────────────────

const start = mock(async () => ({ runId: "wf-run-1" }));
const runAgentLoopStepWorkflow = {};
mock.module("workflow/api", () => ({ start }));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow,
}));

// ── Config mock ───────────────────────────────────────────────────────────────

let loopsEnabled = true;

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => loopsEnabled,
  isAgentLoopRepoAllowed: () => true,
}));

// ── Validation mock ───────────────────────────────────────────────────────────

mock.module("@/lib/agent-loops/validation", () => ({
  validateLoopDefinition: () => ({
    ok: true,
    definition: {
      nodes: [
        {
          id: "start-node",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "end-node",
          kind: "end",
          label: "End",
          position: { x: 100, y: 0 },
        },
      ],
      edges: [
        { id: "e1", source: "start-node", target: "end-node", when: "always" },
      ],
    },
  }),
}));

const bridgeModulePromise = import("./dispatcher-bridge");

const activeLoop = {
  id: "loop-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: {} as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "My Loop",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const enabledTrigger = {
  id: "trigger-1",
  loopId: "loop-1",
  agentId: null,
  userId: "user-1",
  name: "PR trigger",
  kind: "github.pull_request" as const,
  status: "enabled" as const,
  conditions: {},
  schedule: null,
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const githubEvent = {
  source: "github" as const,
  kind: "github.pull_request" as const,
  externalId: "delivery-regression",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "main",
  prNumber: 1,
  occurredAt: "2026-06-01T00:00:00.000Z",
};

function resetMocks() {
  loopsEnabled = true;
  hasActiveRunResult = false;
  createRunCallCount = 0;
  start.mockClear();
  createAgentLoopRun.mockClear();
  hasActiveRunForLoop.mockClear();
  getOwnedAgentLoop.mockClear();
  createAgentLoopStepRun.mockClear();
  updateAgentLoopRunStatus.mockClear();
  recordAgentLoopEvent.mockClear();
}

describe("REGRESSION-326: loop dispatch gate order and result shape", () => {
  beforeEach(resetMocks);

  test("REGRESSION-326-001: single-active-run rule prevents createAgentLoopRun from being called when a run is active", async () => {
    // If this regresses: hasActiveRunForLoop check is removed, and a second
    // run is created for a loop that already has a queued/running run.
    hasActiveRunResult = true;
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-regression-001",
    });

    // Must be skipped — no run created
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    // Critical: createAgentLoopRun must NOT be called
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    // Critical: start() must NOT be called
    expect(start).not.toHaveBeenCalled();
  });

  test("REGRESSION-326-002: feature-disabled gate blocks dispatchManualAgentLoopStart even when loop is owned", async () => {
    // If this regresses: isAgentLoopsEnabled() check is removed from
    // dispatchManualAgentLoopStart, allowing manual starts while the feature is off.
    loopsEnabled = false;
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-regression-002",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("feature_disabled");
    // Ownership check must NOT have been reached (flag short-circuits)
    expect(getOwnedAgentLoop).not.toHaveBeenCalled();
    // No run created, no workflow started
    expect(createAgentLoopRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("REGRESSION-326-003: skipped dispatch returns no runId — caller cannot use runId from a skip result", async () => {
    // If this regresses: a runId is accidentally populated on a skipped result,
    // causing callers to add a garbage runId to loopRunIds.
    loopsEnabled = false;
    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    const result = await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-regression-003",
    });

    // Skipped result must not carry a runId
    expect(result.skipped).toBe(true);
    expect(result.runId).toBeUndefined();
    // TypeScript discriminated union: skipped: true means no runId on the type
    // — this assertion proves the runtime shape matches the type contract
    const runId = result.runId;
    expect(runId).toBeUndefined();
  });

  test("REGRESSION-326-004: dispatchManualAgentLoopStart checks for active run before creating a new run", async () => {
    // If this regresses: hasActiveRunForLoop is not called before createAgentLoopRun,
    // allowing a second run to be created for a loop that already has one.
    hasActiveRunResult = true;
    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    const result = await dispatchManualAgentLoopStart({
      userId: "user-1",
      loopId: "loop-1",
      requestId: "req-regression-004",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    // hasActiveRunForLoop must have been called (ownership check ran first, then active-run check)
    expect(hasActiveRunForLoop).toHaveBeenCalledWith("loop-1");
    // createAgentLoopRun must NOT have been called
    expect(createAgentLoopRun).not.toHaveBeenCalled();
  });
});
