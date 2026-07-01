import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentWithTriggers } from "./store";
import type { NormalizedBackgroundTriggerEvent } from "./types";

mock.module("server-only", () => ({}));

let workflowRunId: string | null = "workflow-1";
const start = mock(async () => ({ runId: workflowRunId }));
const createRunForTrigger = mock(async ({ event }: { event: unknown }) => ({
  created: true,
  run: { id: "run-1" },
  event,
}));
const recordBackgroundAgentEvent = mock(async () => undefined);
let matchingRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];
let webhookRow: {
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
} | null = null;
let scheduleRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];
const listMatchingTriggersForEvent = mock(async () => matchingRows);
const getWebhookTriggerByPublicId = mock(async () => webhookRow);
const listEnabledScheduleTriggers = mock(async () => scheduleRows);
const listStaleBackgroundAgentRuns = mock(async () => []);
const updateBackgroundAgentRunStatus = mock(async () => undefined);
const advanceTriggerScheduleState = mock(async () => undefined);
const recordTriggerSkipReason = mock(async () => undefined);

mock.module("workflow/api", () => ({ start }));

mock.module("@/app/workflows/background-agent", () => ({
  runBackgroundAgentWorkflow: {},
}));

// No agent-loops mocks needed here. dispatcher.ts only imports
// @/lib/agent-loops/* via dynamic import inside loopId-bound trigger branches.
// All triggers in this test file have loopId: null, so those branches never
// execute and the agent-loops modules are never loaded.
// Do NOT register mock.module calls for agent-loops paths in this file —
// doing so pollutes the module registry and breaks dispatcher-bridge.test.ts.

mock.module("./store", () => ({
  advanceTriggerScheduleState,
  createRunForTrigger,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
  listStaleBackgroundAgentRuns,
  listMatchingTriggersForEvent,
  recordBackgroundAgentEvent,
  recordTriggerSkipReason,
  updateBackgroundAgentRunStatus,
}));

const dispatcherModulePromise = import("./dispatcher");

const agent: BackgroundAgentWithTriggers = {
  id: "agent-1",
  userId: "user-1",
  name: "Manual test agent",
  repoOwner: "acme",
  repoName: "widgets",
  triggers: [
    {
      id: "trigger-disabled",
      agentId: "agent-1",
      loopId: null,
      userId: "user-1",
      name: "Disabled",
      kind: "github.issue",
      status: "disabled",
      conditions: {},
      schedule: null,
      webhookPublicId: null,
      webhookSecretHash: null,
      lastRunAt: null,
      nextRunAt: null,
      lastSkipReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "trigger-enabled",
      agentId: "agent-1",
      loopId: null,
      userId: "user-1",
      name: "Pull request",
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
    },
  ],
  description: null,
  status: "enabled",
  instructions: "Run the smoke check.",
  permissions: {},
  outputMode: "none",
  checkCommand: null,
  composioToolkitSlugs: [],
  builtinToolNames: null,
  githubActions: {
    open_pull_request: true,
    comment_on_pr_or_issue: true,
  },
  writeScope: { mode: "this_repo" },
  requireCiGreenForMerge: true,
  modelId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const enabledTrigger = agent.triggers[1];
if (!enabledTrigger) {
  throw new Error("Expected enabled trigger test fixture");
}

const scheduleTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  ...enabledTrigger,
  id: "trigger-schedule",
  name: "Hourly",
  kind: "schedule.cron",
  schedule: "* * * * *",
};

const webhookTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  ...enabledTrigger,
  id: "trigger-webhook",
  name: "Error webhook",
  kind: "webhook.error",
  webhookPublicId: "wh_123",
};

const githubEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.pull_request",
  externalId: "delivery-123",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "feature/widgets",
  prNumber: 12,
  title: "Improve widgets",
};

function resetDispatcherMocks() {
  process.env.BACKGROUND_AGENTS_ENABLED = "true";
  delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
  workflowRunId = "workflow-1";
  matchingRows = [];
  webhookRow = null;
  scheduleRows = [];
  start.mockClear();
  createRunForTrigger.mockClear();
  createRunForTrigger.mockImplementation(
    async ({ event }: { event: unknown }) => ({
      created: true,
      run: { id: "run-1" },
      event,
    }),
  );
  recordBackgroundAgentEvent.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  listMatchingTriggersForEvent.mockClear();
  getWebhookTriggerByPublicId.mockClear();
  listEnabledScheduleTriggers.mockClear();
  advanceTriggerScheduleState.mockClear();
  recordTriggerSkipReason.mockClear();
}

describe("dispatchBackgroundTriggerEvent", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  test("does not start duplicate event deliveries", async () => {
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    createRunForTrigger.mockImplementationOnce(async () => ({
      created: false,
      run: { id: "run-existing" },
      event: githubEvent,
    }));
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-duplicate",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 0,
      duplicates: 1,
      runIds: ["run-existing"],
      loopRunIds: [],
    });
    expect(start).not.toHaveBeenCalled();
    expect(recordBackgroundAgentEvent).not.toHaveBeenCalled();
  });

  test("records typed workflow start failures for GitHub events", async () => {
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    workflowRunId = null;
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-start-failed",
    });

    expect(result.created).toBe(1);
    expect(start).toHaveBeenCalledWith({}, [{ runId: "run-1" }]);
    expect(updateBackgroundAgentRunStatus).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      workflowRunId: null,
      errorKind: "workflow_failed",
      errorMessage: "Failed to start background agent workflow.",
    });
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        eventName: "background-agent.workflow.start_failed",
        status: "failed",
        level: "warn",
        requestId: "req-start-failed",
        errorKind: "workflow_failed",
      }),
    );
  });

  test("does not dispatch GitHub events outside the configured repo allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/other";
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-allowlist",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(listMatchingTriggersForEvent).not.toHaveBeenCalled();
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("dispatchWebhookErrorEvent", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  test("records typed workflow start failures for signed error webhooks", async () => {
    webhookRow = {
      agent,
      trigger: webhookTrigger,
    };
    workflowRunId = null;
    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_123",
      event: {
        externalId: "error-1",
        title: "Unhandled error",
        message: "TypeError",
        occurredAt: "2026-05-27T12:00:00.000Z",
      },
      requestId: "req-webhook",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
      loopRunIds: [],
    });
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        agentId: "agent-1",
        userId: "user-1",
        eventName: "background-agent.workflow.start_failed",
        status: "failed",
        level: "warn",
        requestId: "req-webhook",
        errorKind: "workflow_failed",
      }),
    );
    expect(updateBackgroundAgentRunStatus).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      workflowRunId: null,
      errorKind: "workflow_failed",
      errorMessage: "Failed to start background agent workflow.",
    });
  });

  test("does not dispatch signed webhooks outside the configured repo allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/other";
    webhookRow = {
      agent,
      trigger: webhookTrigger,
    };
    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_123",
      event: {
        externalId: "error-1",
        title: "Unhandled error",
        message: "TypeError",
        occurredAt: "2026-05-27T12:00:00.000Z",
      },
      requestId: "req-webhook",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("does not let signed webhook payload repo values bypass the agent allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "allowed/repo";
    webhookRow = {
      agent: {
        ...agent,
        repoOwner: "blocked",
        repoName: "repo",
      },
      trigger: webhookTrigger,
    };
    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_123",
      event: {
        externalId: "error-1",
        repoOwner: "allowed",
        repoName: "repo",
        title: "Unhandled error",
        message: "TypeError",
        occurredAt: "2026-05-27T12:00:00.000Z",
      },
      requestId: "req-webhook-bypass",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("dispatchScheduledBackgroundAgents", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  test("records trigger and workflow-start evidence for scheduled runs", async () => {
    scheduleRows = [
      {
        agent,
        trigger: scheduleTrigger,
      },
    ];
    workflowRunId = null;
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-05-27T12:34:00.000Z"),
      requestId: "req-cron",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
      loopRunIds: [],
    });
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        agentId: "agent-1",
        userId: "user-1",
        eventName: "background-agent.trigger.received",
        status: "info",
        summary: "Received schedule.cron trigger.",
        requestId: "req-cron",
        payload: {
          source: "schedule",
          triggerKind: "schedule.cron",
          externalId: "trigger-schedule:2026-05-27T12:34",
        },
      }),
    );
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        eventName: "background-agent.workflow.start_failed",
        status: "failed",
        level: "warn",
        requestId: "req-cron",
        errorKind: "workflow_failed",
      }),
    );
    expect(updateBackgroundAgentRunStatus).toHaveBeenCalledWith({
      runId: "run-1",
      status: "failed",
      workflowRunId: null,
      errorKind: "workflow_failed",
      errorMessage: "Failed to start background agent workflow.",
    });
  });

  test("filters scheduled runs by the configured repo allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/other";
    scheduleRows = [
      {
        agent,
        trigger: scheduleTrigger,
      },
    ];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-05-27T12:34:00.000Z"),
      requestId: "req-cron",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("dispatchManualBackgroundAgentTest", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  test("creates a manual test event without forcing a non-existent sandbox branch", async () => {
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
      loopRunIds: [],
    });
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    const createCall = createRunForTrigger.mock.calls[0]?.[0] as {
      trigger: { id: string };
      event: {
        action?: string;
        branch?: string;
        ref?: string;
        kind: string;
        source: string;
        title?: string;
      };
    };
    expect(createCall.trigger.id).toBe("trigger-enabled");
    expect(createCall.event.kind).toBe("github.pull_request");
    expect(createCall.event.source).toBe("github");
    expect(createCall.event.action).toBe("manual_test");
    expect(createCall.event.branch).toBeUndefined();
    expect(createCall.event.ref).toBeUndefined();
    expect(createCall.event.title).toBe("Manual test for Manual test agent");
    expect(start).toHaveBeenCalledWith({}, [{ runId: "run-1" }]);
  });

  test("does not create a manual test run when rollout is disabled", async () => {
    process.env.BACKGROUND_AGENTS_ENABLED = "false";
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("does not create a manual test run outside the configured repo allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/other";
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
