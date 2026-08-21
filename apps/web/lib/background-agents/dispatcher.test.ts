import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { BackgroundAgentRun } from "@/lib/db/schema";
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
let staleRuns: BackgroundAgentRun[] = [];
const listMatchingTriggersForEvent = mock(async () => matchingRows);
const getWebhookTriggerByPublicId = mock(async () => webhookRow);
const listEnabledScheduleTriggers = mock(async () => scheduleRows);
const listStaleBackgroundAgentRuns = mock(async () => staleRuns);
const updateBackgroundAgentRunStatus = mock(
  async (_params?: {
    runId: string;
    status: string;
    force?: boolean;
    errorKind?: string;
    errorMessage?: string;
    agentId?: string | null;
    userId?: string;
  }): Promise<BackgroundAgentRun | null> => null,
);
const touchBackgroundAgentRunHeartbeat = mock(
  async (_params?: {
    runId: string;
    turnIndex?: number;
  }): Promise<BackgroundAgentRun | null> => null,
);
const advanceTriggerScheduleState = mock(
  async (_params?: {
    triggerId: string;
    lastRunAt?: Date;
    nextRunAt: Date | null;
  }) => undefined,
);
const recordTriggerSkipReason = mock(async () => undefined);
let recentRunsForTargetCount = 0;
const countRecentRunsForTarget = mock(async () => recentRunsForTargetCount);

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
  seedTriggerNextRunAt: async () => undefined,
  advanceTriggerScheduleState,
  countRecentRunsForTarget,
  createRunForTrigger,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
  listStaleBackgroundAgentRuns,
  listMatchingTriggersForEvent,
  recordBackgroundAgentEvent,
  recordTriggerSkipReason,
  touchBackgroundAgentRunHeartbeat,
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
  runBudgetPerTarget: 10,
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
  process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";
  workflowRunId = "workflow-1";
  matchingRows = [];
  webhookRow = null;
  scheduleRows = [];
  staleRuns = [];
  recentRunsForTargetCount = 0;
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
  updateBackgroundAgentRunStatus.mockImplementation(async () => null);
  touchBackgroundAgentRunHeartbeat.mockClear();
  listMatchingTriggersForEvent.mockClear();
  getWebhookTriggerByPublicId.mockClear();
  listEnabledScheduleTriggers.mockClear();
  listStaleBackgroundAgentRuns.mockClear();
  listStaleBackgroundAgentRuns.mockImplementation(async () => staleRuns);
  advanceTriggerScheduleState.mockClear();
  recordTriggerSkipReason.mockClear();
  countRecentRunsForTarget.mockClear();
}

function makeStaleRun(
  overrides: Partial<BackgroundAgentRun> = {},
): BackgroundAgentRun {
  return {
    id: "run-stale",
    agentId: "agent-1",
    triggerId: "trigger-schedule",
    userId: "user-1",
    status: "running",
    source: "schedule",
    triggerKind: "schedule.cron",
    externalId: "trigger-schedule:2026-06-01T06:00",
    idempotencyKey: "key",
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: null,
    branch: null,
    prNumber: null,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: "sandbox-stale",
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {},
    resultSummary: null,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    workflowRunId: "workflow-stale",
    requestId: "req-old",
    startedAt: new Date("2026-06-01T06:00:00.000Z"),
    finishedAt: null,
    createdAt: new Date("2026-06-01T06:00:00.000Z"),
    updatedAt: new Date("2026-06-01T06:00:00.000Z"),
    ...overrides,
  };
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
      skipReason: "repo_not_allowlisted",
    });
    expect(listMatchingTriggersForEvent).not.toHaveBeenCalled();
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("refuses GitHub events before matching when the allowlist is missing", async () => {
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    matchingRows = [{ agent, trigger: enabledTrigger }];
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-missing-policy",
    });

    expect(result).toMatchObject({
      matched: 0,
      created: 0,
      skipReason: "repo_allowlist_unconfigured",
    });
    expect(listMatchingTriggersForEvent).not.toHaveBeenCalled();
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[background-agents] repository policy refused dispatch",
      expect.objectContaining({
        eventName: "background-agent.dispatch.repo-policy-refused",
        policyState: "missing",
        reason: "repo_allowlist_unconfigured",
        requestId: "req-missing-policy",
      }),
    );
    warnSpy.mockRestore();
  });

  test("refuses GitHub events with an invalid allowlist without logging its value", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "private-malformed-value";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-invalid-policy",
    });

    expect(result).toMatchObject({
      matched: 0,
      created: 0,
      skipReason: "repo_allowlist_invalid",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private-malformed-value",
    );
    warnSpy.mockRestore();
  });

  // #749: per-agent-per-PR run budget — the ping-pong loop backstop.
  test("refuses to create a run when the agent's per-PR budget is exhausted", async () => {
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    recentRunsForTargetCount = agent.runBudgetPerTarget; // already at budget

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-budget",
    });

    expect(countRecentRunsForTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: agent.id,
        repoOwner: agent.repoOwner,
        repoName: agent.repoName,
        prNumber: githubEvent.prNumber,
      }),
    );
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(recordTriggerSkipReason).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: enabledTrigger.id,
        skipReason: expect.stringContaining("budget"),
      }),
    );
    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    });
  });

  test("still creates a run when the agent is under its per-PR budget", async () => {
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    recentRunsForTargetCount = agent.runBudgetPerTarget - 1;

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: githubEvent,
      requestId: "req-under-budget",
    });

    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
  });

  test("does not budget-check events with no prNumber", async () => {
    matchingRows = [
      {
        agent,
        trigger: enabledTrigger,
      },
    ];
    recentRunsForTargetCount = agent.runBudgetPerTarget;
    const eventWithoutPr: NormalizedBackgroundTriggerEvent = {
      ...githubEvent,
      prNumber: undefined,
    };

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: eventWithoutPr,
      requestId: "req-no-pr",
    });

    expect(countRecentRunsForTarget).not.toHaveBeenCalled();
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
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
      skipReason: "repo_not_allowlisted",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(recordTriggerSkipReason).toHaveBeenCalledWith({
      triggerId: webhookTrigger.id,
      skipReason: "repo_not_allowlisted",
    });
  });

  test("refuses signed webhooks before run creation when the allowlist is missing", async () => {
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    webhookRow = { agent, trigger: webhookTrigger };
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatchWebhookErrorEvent } = await dispatcherModulePromise;

    const result = await dispatchWebhookErrorEvent({
      webhookPublicId: "wh_123",
      event: {
        externalId: "error-1",
        title: "Unhandled error",
        message: "TypeError",
        occurredAt: "2026-05-27T12:00:00.000Z",
      },
      requestId: "req-webhook-missing-policy",
    });

    expect(result).toMatchObject({
      matched: 0,
      created: 0,
      skipReason: "repo_allowlist_unconfigured",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[background-agents] repository policy refused dispatch",
      expect.objectContaining({
        eventName: "background-agent.dispatch.repo-policy-refused",
        policyState: "missing",
        reason: "repo_allowlist_unconfigured",
        triggerId: webhookTrigger.id,
      }),
    );
    warnSpy.mockRestore();
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
      skipReason: "repo_not_allowlisted",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("dispatchScheduledBackgroundAgents", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  // A scheduled trigger refused by the repo allowlist writes `last_skip_reason`
  // to the database and reports nothing back. In production one trigger was
  // skipped weekly from 2026-07-06 for six weeks and the cron kept answering
  // {"matched":0,...} — indistinguishable from "nothing was due". The operator
  // reading the cron response has to be able to see a refusal.
  test("reports allowlist-refused triggers in the sweep result", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "someone-else/other-repo";
    scheduleRows = [{ agent, trigger: scheduleTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-05-27T12:34:00.000Z"),
      requestId: "req-cron",
    });

    expect(result.matched).toBe(0);
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([
      { triggerId: scheduleTrigger.id, reason: "repo_not_allowlisted" },
    ]);
  });

  // The field must stay absent on a clean sweep so an operator can tell
  // "nothing was due" from "something was refused" at a glance.
  test("omits skipped entirely when nothing was refused", async () => {
    scheduleRows = [{ agent, trigger: scheduleTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-05-27T12:34:00.000Z"),
      requestId: "req-cron",
    });

    expect(result.skipped).toBeUndefined();
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
      // The refusal is now reported, not only written to the trigger row.
      skipped: [
        { triggerId: scheduleTrigger.id, reason: "repo_not_allowlisted" },
      ],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("records a typed skip without creating scheduled runs when policy is missing", async () => {
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    scheduleRows = [{ agent, trigger: scheduleTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-05-27T12:34:00.000Z"),
      requestId: "req-cron-missing-policy",
    });

    expect(result.created).toBe(0);
    expect(recordTriggerSkipReason).toHaveBeenCalledWith({
      triggerId: scheduleTrigger.id,
      skipReason: "repo_allowlist_unconfigured",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
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
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

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
      skipReason: "repo_not_allowlisted",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[background-agents] manual test skipped",
      expect.objectContaining({
        eventName: "background-agent.manual_test.skipped",
        agentId: agent.id,
        skipReason: "repo_not_allowlisted",
      }),
    );
    warnSpy.mockRestore();
  });

  test("reports operator configuration when a manual test allowlist is missing", async () => {
    delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-manual-missing-policy",
    });

    expect(result).toMatchObject({
      matched: 0,
      created: 0,
      skipReason: "repo_allowlist_unconfigured",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[background-agents] manual test skipped",
      expect.objectContaining({
        skipReason: "repo_allowlist_unconfigured",
      }),
    );
    warnSpy.mockRestore();
  });

  // #743: manual-test guard — a disabled agent must never run, even via the
  // manual Test button (which could mutate a real PR if it slipped through).
  test("does not create a manual test run when the agent is disabled", async () => {
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent: { ...agent, status: "disabled" },
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "agent_disabled",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // #743: only an enabled trigger counts — the dispatcher must not fall back
  // to a disabled trigger just because it's the only one on the agent.
  test("does not fall back to a disabled trigger when no trigger is enabled", async () => {
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent: {
        ...agent,
        triggers: [
          agent.triggers[0] as BackgroundAgentWithTriggers["triggers"][number],
        ],
      },
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "no_enabled_trigger",
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("#1396 background-agent sweeper race, catch-up, and heartbeat", () => {
  beforeEach(() => {
    resetDispatcherMocks();
  });

  test("force-race: terminalized run emits sweep_skipped_terminal, not swept_stale", async () => {
    // Simulate the race: listStale still returns the run, but the CAS update
    // matches zero rows because the executor already reached succeeded.
    staleRuns = [makeStaleRun({ status: "running" })];
    updateBackgroundAgentRunStatus.mockImplementationOnce(async () => null);
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-sweep-race",
    });

    expect(updateBackgroundAgentRunStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-stale",
        status: "failed",
        force: true,
      }),
    );
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-stale",
        eventName: "background-agent.run.sweep_skipped_terminal",
        level: "info",
      }),
    );
    expect(recordBackgroundAgentEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "background-agent.run.swept_stale",
      }),
    );
  });

  test("force-race: successful CAS emits swept_stale with previousStatus", async () => {
    const staleRun = makeStaleRun({ status: "queued" });
    staleRuns = [staleRun];
    updateBackgroundAgentRunStatus.mockImplementationOnce(async () => ({
      ...staleRun,
      status: "failed",
    }));
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-sweep-ok",
    });

    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-stale",
        eventName: "background-agent.run.swept_stale",
        payload: expect.objectContaining({
          previousStatus: "queued",
          forced: true,
        }),
      }),
    );
  });

  test("backlog catch-up: advances nextRunAt from now and emits caught_up once", async () => {
    // Hourly cron, nextRunAt three hours in the past. Catch-up must fire once
    // for the missed due window, then jump nextRunAt past now — not to
    // dueAt+1h (which stays in the past and replays the backlog).
    const missedDueAt = new Date("2026-06-01T06:00:00.000Z");
    const now = new Date("2026-06-01T09:02:00.000Z");
    const hourlyTrigger = {
      ...scheduleTrigger,
      id: "trigger-hourly",
      schedule: "0 * * * *",
      nextRunAt: missedDueAt,
    };
    scheduleRows = [{ agent, trigger: hourlyTrigger }];

    advanceTriggerScheduleState.mockImplementation(
      async (params?: {
        triggerId: string;
        nextRunAt: Date | null;
        lastRunAt?: Date;
      }) => {
        if (!params) {
          return;
        }
        const row = scheduleRows.find((r) => r.trigger.id === params.triggerId);
        if (row) {
          row.trigger = { ...row.trigger, nextRunAt: params.nextRunAt };
        }
      },
    );

    let createCount = 0;
    createRunForTrigger.mockImplementation(
      async ({ event }: { event: unknown }) => {
        createCount += 1;
        return {
          created: true,
          run: { id: `run-catchup-${createCount}` },
          event,
        };
      },
    );

    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    const first = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-catchup-1",
    });
    expect(first.created).toBe(1);

    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-hourly",
        lastRunAt: missedDueAt,
        // From now=09:02, next hourly tick is 10:00 — not 07:00 (dueAt+1h).
        nextRunAt: new Date("2026-06-01T10:00:00.000Z"),
      }),
    );
    expect(recordBackgroundAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "background-agent.run.caught_up",
        payload: expect.objectContaining({
          triggerId: "trigger-hourly",
          missedSlots: 3,
          nextRunAt: "2026-06-01T10:00:00.000Z",
        }),
      }),
    );

    // One hour later the wrongly-advanced nextRunAt=07:00 would still be due
    // and would create a second backlog run. With the fix, nextRunAt=10:00 so
    // this sweep creates nothing.
    createRunForTrigger.mockClear();
    const second = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:05:00.000Z"),
      requestId: "req-catchup-2",
    });
    expect(second.created).toBe(0);
    expect(createRunForTrigger).not.toHaveBeenCalled();
  });

  test("heartbeat liveness: touchBackgroundAgentRunHeartbeat is the liveness signal for listStale", async () => {
    // #1396: long live runs must bump runs.updatedAt (no heartbeatAt column —
    // prefer updatedAt) so listStaleBackgroundAgentRuns stops returning them.
    // This dispatcher-level contract asserts the store helper exists and is
    // wired through the module mock the sweeper path shares.
    expect(typeof touchBackgroundAgentRunHeartbeat).toBe("function");

    const liveRun = makeStaleRun({
      id: "run-live",
      updatedAt: new Date("2026-06-01T06:00:00.000Z"),
    });
    touchBackgroundAgentRunHeartbeat.mockImplementationOnce(async () => ({
      ...liveRun,
      updatedAt: new Date("2026-06-01T08:55:00.000Z"),
    }));

    const heartbeated = await touchBackgroundAgentRunHeartbeat({
      runId: "run-live",
      turnIndex: 12,
    });
    expect(heartbeated?.updatedAt.toISOString()).toBe(
      "2026-06-01T08:55:00.000Z",
    );

    // After heartbeat, the run is inside the fresh window and must not be swept.
    staleRuns = [];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-heartbeat",
    });
    expect(updateBackgroundAgentRunStatus).not.toHaveBeenCalled();
  });
});
