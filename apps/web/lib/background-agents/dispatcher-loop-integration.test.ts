/**
 * Integration tests for the loop-trigger dispatcher branch (TASK-326 / M1-07).
 *
 * BT-326-12: cron sweep includes due loop trigger + updates nextRunAt
 * BT-326-13: agent-trigger path is UNCHANGED (existing dispatcher behavior preserved)
 * BT-326-15: loop event trigger matches + bridge called
 * BT-326-16: loop-bound webhook.error trigger → bridge called, createRunForTrigger NOT called
 * BT-326-17: agent-bound webhook.error trigger behavior unchanged
 * BT-326-18 (regression): loop-bound webhook.error trigger NEVER reaches createRunForTrigger
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentWithTriggers } from "./store";
import type { NormalizedBackgroundTriggerEvent } from "./types";

mock.module("server-only", () => ({}));

// ── Background-agent dispatcher mocks (must match house pattern exactly) ──────

let workflowRunId: string | null = "workflow-1";
const start = mock(async () => ({ runId: workflowRunId }));
const createRunForTrigger = mock(async () => ({
  created: true,
  run: { id: "run-agent-1" },
}));
const recordBackgroundAgentEvent = mock(async () => undefined);
let matchingAgentRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];
let agentScheduleRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];
let webhookRow: {
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
} | null = null;
const listMatchingTriggersForEvent = mock(async () => matchingAgentRows);
const getWebhookTriggerByPublicId = mock(async () => webhookRow);
const listEnabledScheduleTriggers = mock(async () => agentScheduleRows);
const updateBackgroundAgentRunStatus = mock(async () => undefined);
const advanceTriggerScheduleState = mock(async () => undefined);
const recordTriggerSkipReason = mock(async () => undefined);

mock.module("workflow/api", () => ({ start }));
mock.module("@/app/workflows/background-agent", () => ({
  runBackgroundAgentWorkflow: {},
}));
mock.module("./store", () => ({
  advanceTriggerScheduleState,
  createRunForTrigger,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
  listMatchingTriggersForEvent,
  recordBackgroundAgentEvent,
  recordTriggerSkipReason,
  updateBackgroundAgentRunStatus,
}));

// ── Loop store mock (getAgentLoopById only — dispatcher uses this directly) ───
// The bridge (dispatchLoopRunForTrigger) is mocked entirely above, so the
// store mock here only needs to cover getAgentLoopById which the dispatcher
// calls before delegating to the bridge.

let loopForTriggerResult: {
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

const getAgentLoopById = mock(async () => loopForTriggerResult);

// Mock the agent-loops store. dispatcher.ts imports getAgentLoopById directly.
// Bun isolates mock.module per test file — this does NOT conflict with the
// bridge test file's mock of the same path.
mock.module("@/lib/agent-loops/store", () => ({
  getAgentLoopById,
  createAgentLoopRun: async () => ({
    run: { id: "loop-run-1", status: "queued" },
    created: true,
  }),
  hasActiveRunForLoop: async () => false,
  getOwnedAgentLoop: async () => loopForTriggerResult,
  createAgentLoopStepRun: async () => ({
    id: "step-run-1",
    nodeId: "start-node",
    nodeKind: "start",
    attempt: 1,
  }),
  updateAgentLoopRunStatus: async () => null,
  recordAgentLoopEvent: async () => ({ id: "ev-1" }),
}));

// ── Dispatcher bridge mock ────────────────────────────────────────────────────

let loopDispatchResult: {
  skipped?: boolean;
  reason?: string;
  created?: boolean;
  runId?: string;
} = { created: true, runId: "loop-run-1" };

const dispatchLoopRunForTrigger = mock(async () => loopDispatchResult);

mock.module("@/lib/agent-loops/dispatcher-bridge", () => ({
  dispatchLoopRunForTrigger,
  dispatchManualAgentLoopStart: async () => ({
    created: true,
    runId: "loop-run-manual",
  }),
}));

// Note: @/lib/agent-loops/config is intentionally NOT mocked here.
// dispatcher.ts uses the fully-mocked dispatcher-bridge, so config is never
// evaluated in this test context. Mocking config here would override the
// bridge test file's dynamic config mock in the same Bun process.

const dispatcherModulePromise = import("./dispatcher");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseAgent: BackgroundAgentWithTriggers = {
  id: "agent-loop-int",
  userId: "user-1",
  name: "Loop integration agent",
  repoOwner: "acme",
  repoName: "widgets",
  description: null,
  status: "enabled",
  instructions: "Test agent.",
  permissions: {},
  outputMode: "none",
  checkCommand: null,
  composioToolkitSlugs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  triggers: [],
};

const loopScheduleTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  id: "trigger-loop-cron",
  agentId: null,
  loopId: "loop-cron-1",
  userId: "user-1",
  name: "Loop cron",
  kind: "schedule.cron",
  status: "enabled",
  conditions: {},
  schedule: "* * * * *",
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const loopEventTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  id: "trigger-loop-pr",
  agentId: null,
  loopId: "loop-pr-1",
  userId: "user-1",
  name: "Loop PR trigger",
  kind: "github.pull_request",
  status: "enabled",
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

const agentScheduleTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  id: "trigger-agent-cron",
  agentId: "agent-loop-int",
  loopId: null,
  userId: "user-1",
  name: "Agent cron",
  kind: "schedule.cron",
  status: "enabled",
  conditions: {},
  schedule: "* * * * *",
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const activeLoop = {
  id: "loop-cron-1",
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
  name: "Loop cron",
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const githubEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.pull_request",
  externalId: "delivery-456",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "feature/loop",
  prNumber: 99,
};

function resetIntegrationMocks() {
  process.env.BACKGROUND_AGENTS_ENABLED = "true";
  delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
  workflowRunId = "workflow-1";
  matchingAgentRows = [];
  agentScheduleRows = [];
  webhookRow = null;
  loopForTriggerResult = activeLoop;
  loopDispatchResult = { created: true, runId: "loop-run-1" };
  start.mockClear();
  createRunForTrigger.mockClear();
  recordBackgroundAgentEvent.mockClear();
  listMatchingTriggersForEvent.mockClear();
  listEnabledScheduleTriggers.mockClear();
  getWebhookTriggerByPublicId.mockClear();
  advanceTriggerScheduleState.mockClear();
  recordTriggerSkipReason.mockClear();
  getAgentLoopById.mockClear();
  dispatchLoopRunForTrigger.mockClear();
}

// ── BT-326-12: cron sweep includes loop-bound trigger + updates nextRunAt ─────

describe("dispatchScheduledBackgroundAgents — loop trigger branch", () => {
  beforeEach(resetIntegrationMocks);

  test("BT-326-12: due loop-bound cron trigger dispatches loop run and advances nextRunAt", async () => {
    // Loop schedule trigger (loopId set, agentId null)
    agentScheduleRows = [
      {
        agent: { ...baseAgent, id: "loop-pseudo-agent" },
        trigger: loopScheduleTrigger,
      },
    ];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-loop-cron",
    });

    // Bridge was called for the loop trigger
    expect(dispatchLoopRunForTrigger).toHaveBeenCalledTimes(1);
    // The loop run is in the result
    expect(result.loopRunIds).toBeDefined();
    expect(result.loopRunIds).toContain("loop-run-1");

    // Schedule state advances for the loop trigger
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({ triggerId: "trigger-loop-cron" }),
    );

    // Agent path untouched: createRunForTrigger NOT called
    expect(createRunForTrigger).not.toHaveBeenCalled();
  });

  test("BT-326-12b: loop cron + agent cron both dispatch and both advance nextRunAt", async () => {
    agentScheduleRows = [
      { agent: baseAgent, trigger: agentScheduleTrigger },
      {
        agent: { ...baseAgent, id: "loop-pseudo-agent" },
        trigger: loopScheduleTrigger,
      },
    ];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:01:00.000Z"),
      requestId: "req-both",
    });

    // Agent run created via createRunForTrigger
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);

    // Loop run dispatched via bridge
    expect(dispatchLoopRunForTrigger).toHaveBeenCalledTimes(1);

    // Both schedule states advance
    expect(advanceTriggerScheduleState).toHaveBeenCalledTimes(2);
  });
});

// ── BT-326-15: event trigger dispatch includes loop-bound triggers ─────────────

describe("dispatchBackgroundTriggerEvent — loop trigger branch", () => {
  beforeEach(resetIntegrationMocks);

  test("BT-326-15: matching loop-bound event trigger calls bridge with the matched loop", async () => {
    // listMatchingTriggersForEvent returns a loop-bound trigger
    // The agent field has no id that matches an existing agent, but loopId is set
    matchingAgentRows = [
      {
        agent: { ...baseAgent, id: "loop-event-pseudo" },
        trigger: loopEventTrigger,
      },
    ];
    loopForTriggerResult = { ...activeLoop, id: "loop-pr-1" };

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-loop-event",
    });

    expect(dispatchLoopRunForTrigger).toHaveBeenCalledTimes(1);
    const bridgeCall = dispatchLoopRunForTrigger.mock.calls[0]?.[0] as {
      trigger: { loopId: string | null };
    };
    expect(bridgeCall.trigger.loopId).toBe("loop-pr-1");

    // Loop run id in result
    expect(result.loopRunIds).toBeDefined();
    expect(result.loopRunIds).toContain("loop-run-1");

    // Agent dispatch path NOT called for loop trigger
    expect(createRunForTrigger).not.toHaveBeenCalled();
  });

  // BT-326-13: unchanged agent-trigger behavior gate
  test("BT-326-13: agent-bound event trigger still dispatches via agent path (unchanged)", async () => {
    const agentEventTrigger = {
      ...loopEventTrigger,
      loopId: null,
      agentId: "agent-loop-int",
    };
    matchingAgentRows = [{ agent: baseAgent, trigger: agentEventTrigger }];

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-agent-event",
    });

    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
    // Loop bridge NOT called for agent trigger
    expect(dispatchLoopRunForTrigger).not.toHaveBeenCalled();
  });
});

// ── BT-326-16/17/18: dispatchWebhookErrorEvent loop branch ────────────────────

describe("dispatchWebhookErrorEvent — loop trigger branch", () => {
  beforeEach(resetIntegrationMocks);

  // Fixture: a loop-bound webhook.error trigger row returned by getWebhookTriggerByPublicId
  const loopWebhookTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
    id: "trigger-loop-webhook",
    agentId: null,
    loopId: "loop-webhook-1",
    userId: "user-1",
    name: "Loop webhook error",
    kind: "webhook.error",
    status: "enabled",
    conditions: {},
    schedule: null,
    webhookPublicId: "wh_loop_123",
    webhookSecretHash: "hash-abc",
    lastRunAt: null,
    nextRunAt: null,
    lastSkipReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const agentWebhookTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
    id: "trigger-agent-webhook",
    agentId: "agent-loop-int",
    loopId: null,
    userId: "user-1",
    name: "Agent webhook error",
    kind: "webhook.error",
    status: "enabled",
    conditions: {},
    schedule: null,
    webhookPublicId: "wh_agent_456",
    webhookSecretHash: "hash-xyz",
    lastRunAt: null,
    nextRunAt: null,
    lastSkipReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test("BT-326-16: loop-bound webhook.error trigger calls bridge, NOT createRunForTrigger, loopRunIds populated", async () => {
    // Arrange: getWebhookTriggerByPublicId returns a loop-bound trigger row.
    // The agent row accompanying it has status "enabled" (required by the guard)
    // and loopId on the trigger is set to "loop-webhook-1".
    webhookRow = {
      agent: { ...baseAgent, status: "enabled" },
      trigger: loopWebhookTrigger,
    };
    loopForTriggerResult = { ...activeLoop, id: "loop-webhook-1" };
    loopDispatchResult = { created: true, runId: "loop-run-webhook-1" };

    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_loop_123",
      event: {
        externalId: "err-loop-1",
        title: "Unhandled error",
        message: "TypeError: cannot read property",
        occurredAt: "2026-06-11T10:00:00.000Z",
      },
      requestId: "req-loop-webhook",
    });

    // Bridge must be called with the loop and trigger
    expect(dispatchLoopRunForTrigger).toHaveBeenCalledTimes(1);
    const bridgeCall = dispatchLoopRunForTrigger.mock.calls[0]?.[0] as {
      loop: { id: string };
      trigger: { id: string; loopId: string | null };
      event: { source: string; kind: string; externalId: string | null | undefined };
    };
    expect(bridgeCall.trigger.loopId).toBe("loop-webhook-1");
    expect(bridgeCall.event.source).toBe("webhook");
    expect(bridgeCall.event.kind).toBe("webhook.error");
    expect(bridgeCall.event.externalId).toBe("err-loop-1");

    // Agent path must NOT be called
    expect(createRunForTrigger).not.toHaveBeenCalled();

    // Loop run id must appear in result
    expect(result.loopRunIds).toContain("loop-run-webhook-1");
    expect(result.enabled).toBe(true);
    expect(result.matched).toBe(1);
  });

  test("BT-326-17: agent-bound webhook.error trigger behavior unchanged — createRunForTrigger called, bridge NOT called", async () => {
    webhookRow = {
      agent: { ...baseAgent, status: "enabled" },
      trigger: agentWebhookTrigger,
    };

    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_agent_456",
      event: {
        externalId: "err-agent-1",
        title: "Unhandled error",
        message: "ReferenceError",
        occurredAt: "2026-06-11T10:00:00.000Z",
      },
      requestId: "req-agent-webhook",
    });

    // Agent path called as before
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    // Bridge NOT called for agent trigger
    expect(dispatchLoopRunForTrigger).not.toHaveBeenCalled();

    expect(result.created).toBe(1);
    expect(result.loopRunIds).toEqual([]);
    expect(result.runIds).toContain("run-agent-1");
  });
});
