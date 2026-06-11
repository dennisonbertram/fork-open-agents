/**
 * Integration tests for the loop-trigger dispatcher branch (TASK-326 / M1-07).
 *
 * BT-326-12: cron sweep includes due loop trigger + updates nextRunAt
 * BT-326-13: agent-trigger path is UNCHANGED (existing dispatcher behavior preserved)
 * BT-326-15: loop event trigger matches + bridge called
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
const listMatchingTriggersForEvent = mock(async () => matchingAgentRows);
const getWebhookTriggerByPublicId = mock(async () => null);
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

// ── Loop store mocks ──────────────────────────────────────────────────────────

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

mock.module("@/lib/agent-loops/store", () => ({
  getAgentLoopById,
  createAgentLoopRun: async () => ({ run: { id: "loop-run-1", status: "queued" }, created: true }),
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
  dispatchManualAgentLoopStart: async () => ({ created: true, runId: "loop-run-manual" }),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled: () => true,
  isAgentLoopRepoAllowed: () => true,
}));

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
      { id: "start-node", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      { id: "end-node", kind: "end", label: "End", position: { x: 100, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start-node", target: "end-node", when: "always" }],
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
  loopForTriggerResult = activeLoop;
  loopDispatchResult = { created: true, runId: "loop-run-1" };
  start.mockClear();
  createRunForTrigger.mockClear();
  recordBackgroundAgentEvent.mockClear();
  listMatchingTriggersForEvent.mockClear();
  listEnabledScheduleTriggers.mockClear();
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
      { agent: { ...baseAgent, id: "loop-pseudo-agent" }, trigger: loopScheduleTrigger },
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
      { agent: { ...baseAgent, id: "loop-pseudo-agent" }, trigger: loopScheduleTrigger },
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
      { agent: { ...baseAgent, id: "loop-event-pseudo" }, trigger: loopEventTrigger },
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
    const agentEventTrigger = { ...loopEventTrigger, loopId: null, agentId: "agent-loop-int" };
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
