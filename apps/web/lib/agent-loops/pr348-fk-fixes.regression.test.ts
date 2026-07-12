/**
 * Agent Loops — PR #348 FK-fix REGRESSION tests (TASK-348)
 *
 * These tests would FAIL if the implementation in fix: TASK-348 (6130aee5) is reverted.
 *
 * Regression scenarios:
 *
 * REGRESSION-348-001: active-run skip event is always attributed to a real run
 *   If hasActiveRunForLoop reverts to boolean: the code would pass "no-run" as
 *   loopRunId → PG 23503 FK violation at runtime.
 *   The FK-enforcing mock makes this detectable at test time.
 *
 * REGRESSION-348-002: manual start never stores a synthetic trigger id
 *   If triggerIdOverride: null is removed: the mock throws FK violation on
 *   triggerId: "manual" → detectable at test time.
 *
 * REGRESSION-348-003: real trigger dispatches still carry the correct triggerId
 *   After adding triggerIdOverride, trigger-driven dispatches must still pass
 *   trigger.id (a real FK value) to createAgentLoopRun. Regression check: the
 *   triggerId in the created run matches the trigger fixture's id.
 *
 * REGRESSION-348-004: hasActiveRunForLoop signature — store returns string | null
 *   If the store reverts to boolean, callers that do `if (activeRunId)` would
 *   still work, but calling code that uses the value AS a run id would break.
 *   This test directly verifies the mock returns a string when there's an active run.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── FK-enforcing store mocks (same contract as pr348-fk-fixes.test.ts) ─────────

const KNOWN_RUN_IDS_REG = new Set<string>();

const recordAgentLoopEventRegMock = mock(
  async (input: { loopRunId: string; eventName: string }) => {
    if (
      input.loopRunId === "no-run" ||
      !KNOWN_RUN_IDS_REG.has(input.loopRunId)
    ) {
      throw new Error(
        `REGRESSION: FK violation: agent_loop_events.loop_run_id="${input.loopRunId}" ` +
          `not in agent_loop_runs — this means the active-run skip path reverted to "no-run"`,
      );
    }
    return { id: "reg-evt", loopRunId: input.loopRunId, createdAt: new Date() };
  },
);

const KNOWN_TRIGGER_IDS_REG = new Set<string>(["trigger-reg-1"]);

const createAgentLoopRunRegMock = mock(
  async (input: {
    loopId: string;
    userId: string;
    source: string;
    triggerId?: string | null;
    idempotencyKey: string;
  }) => {
    if (input.triggerId !== null && input.triggerId !== undefined) {
      if (!KNOWN_TRIGGER_IDS_REG.has(input.triggerId)) {
        throw new Error(
          `REGRESSION: FK violation: agent_loop_runs.trigger_id="${input.triggerId}" ` +
            `not in background_agent_triggers — manual starts must pass null, not "manual"`,
        );
      }
    }
    const runId = `reg-run-${input.idempotencyKey.replace(/[^a-z0-9-]/g, "-")}`;
    KNOWN_RUN_IDS_REG.add(runId);
    return { run: { id: runId, status: "queued" }, created: true };
  },
);

let regActiveRunId: string | null = null;
const hasActiveRunForLoopRegMock = mock(async () => regActiveRunId);

let regOwnedLoop: {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  status: string;
  definition: Record<string, unknown>;
  guardrails: null;
  permissions: Record<string, unknown>;
  name: string;
  description: null;
  createdAt: Date;
  updatedAt: Date;
} | null = null;

const getOwnedAgentLoopRegMock = mock(async () => regOwnedLoop);

const createAgentLoopStepRunRegMock = mock(async () => ({
  id: "reg-step-1",
  loopRunId: "reg-run-1",
  nodeId: "start-node",
  nodeKind: "start",
  attempt: 1,
  status: "queued",
  createdAt: new Date(),
  updatedAt: new Date(),
}));

// setInitialStepPointer — new helper added in PR-352 fix; included so the
// store mock resolves cleanly when dispatcher-bridge.ts imports it.
const setInitialStepPointerRegMock = mock(async () => ({ id: "reg-run" }));

mock.module("@/lib/agent-loops/store", () => ({
  isAgentLoopRunSourceLive: mock(async () => true),
  createAndAdvanceAgentLoopStep: mock(async () => ({
    outcome: "source_deleted" as const,
  })),
  createAgentLoopRun: createAgentLoopRunRegMock,
  hasActiveRunForLoop: hasActiveRunForLoopRegMock,
  getOwnedAgentLoop: getOwnedAgentLoopRegMock,
  createAgentLoopStepRun: createAgentLoopStepRunRegMock,
  updateAgentLoopRunStatus: mock(async () => null),
  recordAgentLoopEvent: recordAgentLoopEventRegMock,
  setInitialStepPointer: setInitialStepPointerRegMock,
  updateAgentLoopRunContext: mock(async () => undefined),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

// ── Workflow / config / validation mocks ──────────────────────────────────────

const regStartMock = mock(async () => ({ runId: "wf-reg-1" }));
const runAgentLoopStepWorkflow = {};
mock.module("workflow/api", () => ({ start: regStartMock }));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => true,
  getAgentLoopRepoAccess: () => ({ allowed: true }),
  isAgentLoopRepoAllowed: () => true,
}));

const regValidDefinition = {
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
};

mock.module("@/lib/agent-loops/validation", () => ({
  validateLoopDefinition: () => ({ ok: true, definition: regValidDefinition }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const regActiveLoop = {
  id: "loop-reg-1",
  userId: "user-reg-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: regValidDefinition as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "Regression Loop",
  description: null,
  watchdogEnabled: false,
  watchdogInstructions: null,
  watchdogRetryBudget: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const regTrigger = {
  id: "trigger-reg-1",
  loopId: "loop-reg-1",
  agentId: null,
  userId: "user-reg-1",
  name: "Reg trigger",
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

const regGithubEvent = {
  source: "github" as const,
  kind: "github.pull_request" as const,
  externalId: "delivery-reg-1",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "feature/reg",
  prNumber: 99,
  occurredAt: "2026-06-11T12:00:00.000Z",
};

function resetRegMocks() {
  regActiveRunId = null;
  KNOWN_RUN_IDS_REG.clear();
  regOwnedLoop = regActiveLoop;
  regStartMock.mockClear();
  createAgentLoopRunRegMock.mockClear();
  hasActiveRunForLoopRegMock.mockClear();
  getOwnedAgentLoopRegMock.mockClear();
  createAgentLoopStepRunRegMock.mockClear();
  recordAgentLoopEventRegMock.mockClear();
}

// ── Import under test ─────────────────────────────────────────────────────────

const bridgeRegModulePromise = import("./dispatcher-bridge");

// ─────────────────────────────────────────────────────────────────────────────

describe("REGRESSION-348: FK violations in dispatcher-bridge", () => {
  beforeEach(resetRegMocks);

  test("REGRESSION-348-001: active-run skip event is always attributed to the real active run id", async () => {
    // If hasActiveRunForLoop reverts to returning boolean `true`, the skip
    // event would use loopRunId: "no-run" → FK violation throw from the mock.
    const existingRunId = "run-that-already-exists";
    regActiveRunId = existingRunId;
    KNOWN_RUN_IDS_REG.add(existingRunId);

    const { dispatchLoopRunForTrigger } = await bridgeRegModulePromise;

    // Must not throw
    await expect(
      dispatchLoopRunForTrigger({
        loop: regActiveLoop,
        trigger: regTrigger,
        event: regGithubEvent,
        requestId: "reg-req-001",
      }),
    ).resolves.toMatchObject({ skipped: true, reason: "active_run" });

    // Skip event was recorded with the real run id (not "no-run")
    const skipCall = (
      recordAgentLoopEventRegMock.mock.calls as unknown as Array<
        [{ loopRunId: string; eventName: string }]
      >
    ).find(
      (args) => args[0].eventName === "agent-loop.trigger.skipped_active_run",
    );
    expect(skipCall).toBeDefined();
    expect(skipCall?.[0].loopRunId).toBe(existingRunId);
    expect(skipCall?.[0].loopRunId).not.toBe("no-run");
  });

  test("REGRESSION-348-002: manual start never stores a synthetic trigger id (no FK violation)", async () => {
    // If triggerIdOverride: null is removed, dispatchManualAgentLoopStart would
    // pass triggerId: "manual" → FK violation throw from the mock.
    regActiveRunId = null;
    regOwnedLoop = regActiveLoop;

    const { dispatchManualAgentLoopStart } = await bridgeRegModulePromise;

    // Must not throw FK violation
    await expect(
      dispatchManualAgentLoopStart({
        userId: "user-reg-1",
        loopId: "loop-reg-1",
        requestId: "reg-req-002",
      }),
    ).resolves.toMatchObject({ created: true });

    // createAgentLoopRun was called with triggerId: null
    const createCall = (
      createAgentLoopRunRegMock.mock.calls[0] as unknown as [
        { triggerId: string | null | undefined },
      ]
    )[0];
    expect(createCall.triggerId).toBeNull();
  });

  test("REGRESSION-348-003: real trigger dispatches still carry the correct triggerId", async () => {
    // Regression check: adding triggerIdOverride param must not silently null out
    // triggerId for real trigger-driven dispatches.
    regActiveRunId = null;

    const { dispatchLoopRunForTrigger } = await bridgeRegModulePromise;

    await dispatchLoopRunForTrigger({
      loop: regActiveLoop,
      trigger: regTrigger,
      event: regGithubEvent,
      requestId: "reg-req-003",
    });

    const createCall = (
      createAgentLoopRunRegMock.mock.calls[0] as unknown as [
        { triggerId: string | null | undefined },
      ]
    )[0];
    // Real trigger dispatch must use trigger.id (not null, not "manual")
    expect(createCall.triggerId).toBe("trigger-reg-1");
  });

  test("REGRESSION-348-004: hasActiveRunForLoop returns the run id string, not a boolean", async () => {
    // The store function now returns string | null. If it reverts to boolean,
    // callers that use the return value as a run id string would silently break
    // (pass "true" as loopRunId, triggering FK violation in production).
    const knownRunId = "run-sig-check";
    KNOWN_RUN_IDS_REG.add(knownRunId);
    regActiveRunId = knownRunId;

    const { dispatchLoopRunForTrigger } = await bridgeRegModulePromise;

    // Must complete without FK violation (mock enforces string run id)
    const result = await dispatchLoopRunForTrigger({
      loop: regActiveLoop,
      trigger: regTrigger,
      event: regGithubEvent,
      requestId: "reg-req-004",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("active_run");
    // The mock received a proper string run id (not "true" or "false")
    const skipCall = (
      recordAgentLoopEventRegMock.mock.calls as unknown as Array<
        [{ loopRunId: string }]
      >
    ).find((a) => a[0].loopRunId !== undefined);
    const usedRunId = skipCall?.[0].loopRunId;
    expect(typeof usedRunId).toBe("string");
    expect(usedRunId).toBe(knownRunId);
  });
});
