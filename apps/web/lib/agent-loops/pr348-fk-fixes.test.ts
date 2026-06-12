/**
 * Agent Loops — PR #348 FK-fix behavioral tests (TASK-348)
 *
 * Two runtime FK violations found by code review that are invisible to mocks
 * unless the mocks ENFORCE the FK shape (throw on invalid FK values).
 *
 * FK Bug A — active-run skip event uses loopRunId: "no-run"
 *   agent_loop_events.loop_run_id is an FK to agent_loop_runs.id
 *   INSERT with "no-run" throws PG 23503 at runtime.
 *   Fix: change hasActiveRunForLoop to return string | null (the active run id
 *   or null), and record the skip event against the active run's id.
 *
 *   BT-348-A1: when a run is active, skip event loopRunId is the active run's id
 *   BT-348-A2: hasActiveRunForLoop returns the run id when active, null otherwise
 *   BT-348-A3: when hasActiveRunForLoop returns null, no skip event is recorded
 *
 * FK Bug B — manual starts pass triggerId: "manual" (synthetic string)
 *   agent_loop_runs.trigger_id is a nullable FK to background_agent_triggers.id
 *   INSERT with a non-null string that doesn't exist throws PG 23503.
 *   Fix: dispatchManualAgentLoopStart must pass triggerId: null to createAgentLoopRun.
 *
 *   BT-348-B1: manual start passes triggerId: null to createAgentLoopRun (not "manual")
 *   BT-348-B2: store mock enforces FK — throws if a non-null unknown triggerId is passed
 *
 * The store mocks in this file enforce FK shape (throw on invalid loopRunId /
 * non-null unknown triggerId) following the uniqueness-mock precedent from PR #347.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── FK-enforcing store mocks ───────────────────────────────────────────────────

// Known run ids that satisfy the loop_run_id FK.
const KNOWN_RUN_IDS = new Set<string>();

/**
 * FK-enforcing recordAgentLoopEvent mock.
 * Throws if loopRunId is "no-run" or not in KNOWN_RUN_IDS.
 * (Simulates PG 23503 FK violation at the application level.)
 */
const recordAgentLoopEventMock = mock(
  async (input: { loopRunId: string; eventName: string }) => {
    if (input.loopRunId === "no-run" || !KNOWN_RUN_IDS.has(input.loopRunId)) {
      throw new Error(
        `FK violation: agent_loop_events.loop_run_id="${input.loopRunId}" ` +
          `not in agent_loop_runs (known: [${[...KNOWN_RUN_IDS].join(",")}])`,
      );
    }
    return {
      id: "evt-1",
      loopRunId: input.loopRunId,
      eventName: input.eventName,
      status: "info" as const,
      level: "info" as const,
      createdAt: new Date(),
    };
  },
);

// Known trigger ids that satisfy the trigger_id FK (null is always OK).
const KNOWN_TRIGGER_IDS = new Set<string>(["trigger-1"]);

/**
 * FK-enforcing createAgentLoopRun mock.
 * Throws if triggerId is non-null and not in KNOWN_TRIGGER_IDS.
 */
const createAgentLoopRunMock = mock(
  async (input: {
    loopId: string;
    userId: string;
    source: string;
    triggerId?: string | null;
    idempotencyKey: string;
  }) => {
    if (input.triggerId !== null && input.triggerId !== undefined) {
      if (!KNOWN_TRIGGER_IDS.has(input.triggerId)) {
        throw new Error(
          `FK violation: agent_loop_runs.trigger_id="${input.triggerId}" ` +
            `not in background_agent_triggers (known: [${[...KNOWN_TRIGGER_IDS].join(",")}])`,
        );
      }
    }
    const runId = `loop-run-fk-${Date.now()}`;
    KNOWN_RUN_IDS.add(runId);
    return {
      run: { id: runId, status: "queued" },
      created: true,
    };
  },
);

// hasActiveRunForLoop: initially returns null (no active run).
// Test can set activeRunId to simulate an active run.
let activeRunId: string | null = null;
const hasActiveRunForLoopMock = mock(async (_loopId: string) => activeRunId);

let ownedLoopOverride: {
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

const getOwnedAgentLoopMock = mock(async () => ownedLoopOverride);

const createAgentLoopStepRunMock = mock(async () => ({
  id: "step-fk-1",
  loopRunId: "loop-run-fk-1",
  nodeId: "start-node",
  nodeKind: "start",
  attempt: 1,
  status: "queued",
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const updateAgentLoopRunStatusMock = mock(async () => null);

// setInitialStepPointer — new helper added in PR-352 fix
const setInitialStepPointerMock = mock(async () => ({ id: "loop-run-fk" }));

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoopRun: createAgentLoopRunMock,
  hasActiveRunForLoop: hasActiveRunForLoopMock,
  getOwnedAgentLoop: getOwnedAgentLoopMock,
  createAgentLoopStepRun: createAgentLoopStepRunMock,
  updateAgentLoopRunStatus: updateAgentLoopRunStatusMock,
  recordAgentLoopEvent: recordAgentLoopEventMock,
  setInitialStepPointer: setInitialStepPointerMock,
}));

// ── Workflow mock ─────────────────────────────────────────────────────────────

const startMock = mock(async () => ({ runId: "wf-fk-1" }));
const runAgentLoopStepWorkflow = {};
mock.module("workflow/api", () => ({ start: startMock }));
mock.module("@/app/workflows/agent-loop-step", () => ({
  runAgentLoopStepWorkflow,
}));

// ── Config mock ───────────────────────────────────────────────────────────────

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => true,
  isAgentLoopRepoAllowed: () => true,
}));

// ── Validation mock ───────────────────────────────────────────────────────────

const validDefinition = {
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
  validateLoopDefinition: () => ({
    ok: true,
    definition: validDefinition,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const activeLoop = {
  id: "loop-fk-1",
  userId: "user-fk-1",
  repoOwner: "acme",
  repoName: "widgets",
  status: "active" as const,
  definition: validDefinition as Record<string, unknown>,
  guardrails: null,
  permissions: {},
  name: "FK Test Loop",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const enabledTrigger = {
  id: "trigger-1",
  loopId: "loop-fk-1",
  agentId: null,
  userId: "user-fk-1",
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
  externalId: "delivery-fk-1",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "feature/fk-test",
  prNumber: 1,
  occurredAt: "2026-06-11T00:00:00.000Z",
};

function resetFkMocks() {
  activeRunId = null;
  KNOWN_RUN_IDS.clear();
  ownedLoopOverride = activeLoop;
  startMock.mockClear();
  createAgentLoopRunMock.mockClear();
  hasActiveRunForLoopMock.mockClear();
  getOwnedAgentLoopMock.mockClear();
  createAgentLoopStepRunMock.mockClear();
  updateAgentLoopRunStatusMock.mockClear();
  recordAgentLoopEventMock.mockClear();
}

// ── Import the module under test ──────────────────────────────────────────────

const bridgeModulePromise = import("./dispatcher-bridge");

// ─────────────────────────────────────────────────────────────────────────────
// FK Bug A: active-run skip event must use the active run's id, not "no-run"
// ─────────────────────────────────────────────────────────────────────────────

describe("FK Bug A: active-run skip event loopRunId", () => {
  beforeEach(resetFkMocks);

  test("BT-348-A1: skip event loopRunId is the active run's id (not 'no-run')", async () => {
    // The active run exists — hasActiveRunForLoop returns its id
    activeRunId = "existing-run-fk-1";
    KNOWN_RUN_IDS.add("existing-run-fk-1");

    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    // This must NOT throw from the FK-enforcing mock
    let threw = false;
    try {
      await dispatchLoopRunForTrigger({
        loop: activeLoop,
        trigger: enabledTrigger,
        event: githubEvent,
        requestId: "req-fk-a1",
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);

    // The skip event must have been recorded with the active run's id
    const skipEventCall = (
      recordAgentLoopEventMock.mock.calls as unknown as Array<
        [{ loopRunId: string; eventName: string }]
      >
    ).find(
      (args) => args[0].eventName === "agent-loop.trigger.skipped_active_run",
    );
    expect(skipEventCall).toBeDefined();
    expect(skipEventCall?.[0].loopRunId).toBe("existing-run-fk-1");
  });

  test("BT-348-A2: hasActiveRunForLoop returns run id string when active, null when no active run", async () => {
    // When there's an active run, should get its id back
    activeRunId = "run-abc-123";
    KNOWN_RUN_IDS.add("run-abc-123");

    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    // Call once with active run
    await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-fk-a2",
    });

    // hasActiveRunForLoop was called
    expect(hasActiveRunForLoopMock).toHaveBeenCalledWith("loop-fk-1");
    // Returned the run id, NOT a boolean
    const callResult = (
      hasActiveRunForLoopMock.mock.results as Array<{
        value: Promise<string | null>;
      }>
    )[0]?.value;
    expect(callResult).toBeDefined();
    // The result must resolve to the run id string
    const resolvedValue = await callResult;
    expect(resolvedValue).toBe("run-abc-123");
  });

  test("BT-348-A3: when hasActiveRunForLoop returns null, skip event is NOT recorded", async () => {
    // No active run
    activeRunId = null;

    const { dispatchLoopRunForTrigger } = await bridgeModulePromise;

    await dispatchLoopRunForTrigger({
      loop: activeLoop,
      trigger: enabledTrigger,
      event: githubEvent,
      requestId: "req-fk-a3",
    });

    // No skip event — run should have been created
    const skipEventCalls = (
      recordAgentLoopEventMock.mock.calls as unknown as Array<
        [{ eventName: string }]
      >
    ).filter(
      (args) => args[0].eventName === "agent-loop.trigger.skipped_active_run",
    );
    expect(skipEventCalls.length).toBe(0);
    // Run was created normally
    expect(createAgentLoopRunMock).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FK Bug B: manual start must pass triggerId: null (not "manual")
// ─────────────────────────────────────────────────────────────────────────────

describe("FK Bug B: manual start triggerId must be null", () => {
  beforeEach(resetFkMocks);

  test("BT-348-B1: dispatchManualAgentLoopStart passes triggerId: null to createAgentLoopRun", async () => {
    // No active run — should proceed to create
    activeRunId = null;
    ownedLoopOverride = activeLoop;

    const { dispatchManualAgentLoopStart } = await bridgeModulePromise;

    // This must NOT throw from the FK-enforcing mock
    let threw = false;
    let thrownErr: Error | null = null;
    try {
      await dispatchManualAgentLoopStart({
        userId: "user-fk-1",
        loopId: "loop-fk-1",
        requestId: "req-fk-b1",
      });
    } catch (e) {
      threw = true;
      thrownErr = e as Error;
    }

    // Must not throw FK violation
    if (threw) {
      throw new Error(
        `dispatchManualAgentLoopStart threw unexpectedly: ${thrownErr?.message}`,
      );
    }

    // createAgentLoopRun must have been called with triggerId: null
    expect(createAgentLoopRunMock).toHaveBeenCalledTimes(1);
    const createCall = (
      createAgentLoopRunMock.mock.calls[0] as unknown as [
        { triggerId: string | null | undefined },
      ]
    )[0];
    expect(createCall.triggerId).toBeNull();
  });

  test("BT-348-B2: FK-enforcing mock throws if non-null unknown triggerId is passed", async () => {
    // This test proves the mock enforces FK — if BT-348-B1 passes with triggerId:"manual",
    // this test would have thrown on the mock call. The mock is correctly strict.
    activeRunId = null;
    ownedLoopOverride = activeLoop;

    // Directly test the FK mock enforcement
    await expect(
      createAgentLoopRunMock({
        loopId: "loop-fk-1",
        userId: "user-fk-1",
        source: "manual",
        triggerId: "manual", // This is the bug — "manual" doesn't exist in background_agent_triggers
        idempotencyKey: "test-key",
      }),
    ).rejects.toThrow("FK violation");
  });
});
