/**
 * Tests for event-trigger matching behavior — TASK-168
 * Proves match → 1 run, no-match → 0 runs, duplicate → existing run (idempotency).
 *
 * BT-168-MATCH-001: PR event matching configured PR trigger creates one run
 * BT-168-MATCH-002: PR event NOT matching conditions (wrong action) creates zero runs
 * BT-168-MATCH-003: Issue event matching configured issue trigger creates one run
 * BT-168-MATCH-004: Issue event NOT matching label condition creates zero runs
 * BT-168-MATCH-005: Deployment event matching deployment trigger creates one run
 * BT-168-MATCH-006: Deployment event NOT matching environment creates zero runs
 * BT-168-MATCH-007: Duplicate webhook delivery → idempotency returns existing run, no new run
 * BT-168-MATCH-008: Duplicate webhook delivery → no second workflow started
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { triggerMatchesEvent } from "./matching";
import type { NormalizedBackgroundTriggerEvent } from "./types";
import type { BackgroundAgentWithTriggers } from "./store";

// ---- Pure matching tests (no mocks needed) ----------------------------------

describe("triggerMatchesEvent — GitHub event triggers (BT-168)", () => {
  // BT-168-MATCH-001: PR event matching PR trigger
  test("BT-168-MATCH-001: PR event with matching action returns true", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:123:opened:abc",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
      branch: "main",
      prNumber: 123,
      labels: [],
    };

    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["opened", "synchronize"] } },
        event,
      ),
    ).toBe(true);
  });

  // BT-168-MATCH-002: PR event NOT matching configured action → no run
  test("BT-168-MATCH-002: PR event with non-matching action returns false", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:123:closed:abc",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
      branch: "main",
      prNumber: 123,
    };

    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["opened", "synchronize"] } },
        event,
      ),
    ).toBe(false);
  });

  // BT-168-MATCH-003: Issue event matching configured issue trigger
  test("BT-168-MATCH-003: Issue event with matching action returns true", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.issue",
      externalId: "issue:42:labeled",
      repoOwner: "acme",
      repoName: "widgets",
      action: "labeled",
      issueNumber: 42,
      labels: ["bug"],
    };

    expect(
      triggerMatchesEvent({ conditions: { actions: ["labeled"] } }, event),
    ).toBe(true);
  });

  // BT-168-MATCH-004: Issue event NOT matching label condition → no run
  test("BT-168-MATCH-004: Issue event without required label returns false", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.issue",
      externalId: "issue:42:labeled",
      repoOwner: "acme",
      repoName: "widgets",
      action: "labeled",
      issueNumber: 42,
      labels: ["enhancement"],
    };

    expect(
      triggerMatchesEvent({ conditions: { labels: ["bug"] } }, event),
    ).toBe(false);
  });

  // BT-168-MATCH-005: Deployment event matching deployment trigger
  // Note: deployment_status normalization sets action = state ("success", "failure", etc.)
  // and environment = environment. conditions.actions matches event.action.
  // conditions.environments matches event.environment.
  test("BT-168-MATCH-005: Deployment event with matching environment and action returns true", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.deployment_status",
      externalId: "deployment_status:77:success",
      repoOwner: "acme",
      repoName: "widgets",
      action: "success",
      environment: "production",
    };

    expect(
      triggerMatchesEvent(
        { conditions: { environments: ["production"], actions: ["success"] } },
        event,
      ),
    ).toBe(true);
  });

  // BT-168-MATCH-006: Deployment event NOT matching environment → no run
  test("BT-168-MATCH-006: Deployment event with wrong environment returns false", () => {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.deployment_status",
      externalId: "deployment_status:77:success",
      repoOwner: "acme",
      repoName: "widgets",
      action: "success",
      environment: "preview",
    };

    expect(
      triggerMatchesEvent(
        { conditions: { environments: ["production"] } },
        event,
      ),
    ).toBe(false);
  });
});

// ---- Dispatcher-level idempotency tests (mocked store) ----------------------

mock.module("server-only", () => ({}));

const start = mock(async () => ({ runId: "workflow-new" }));
let createRunResult: { created: boolean; run: { id: string } } = {
  created: true,
  run: { id: "run-new" },
};
const createRunForTrigger = mock(async (_params: unknown) => createRunResult);
const recordBackgroundAgentEvent = mock(async () => undefined);
const updateBackgroundAgentRunStatus = mock(async () => undefined);
let matchingRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];
const listMatchingTriggersForEvent = mock(async () => matchingRows);
const getWebhookTriggerByPublicId = mock(async () => null);
const listEnabledScheduleTriggers = mock(async () => []);
const listStaleBackgroundAgentRuns = mock(async () => []);
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
  seedTriggerNextRunAt: async () => undefined,
  advanceTriggerScheduleState,
  countRecentRunsForTarget: async () => 0,
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

const baseAgent: BackgroundAgentWithTriggers = {
  id: "agent-168",
  userId: "user-1",
  name: "Event trigger agent",
  repoOwner: "acme",
  repoName: "widgets",
  description: null,
  status: "enabled",
  instructions: "Handle GitHub events.",
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
  triggers: [
    {
      id: "trigger-pr",
      agentId: "agent-168",
      loopId: null,
      userId: "user-1",
      name: "Pull request",
      kind: "github.pull_request",
      status: "enabled",
      conditions: { actions: ["opened"] },
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
};

const prEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.pull_request",
  externalId: "pull_request:999:opened:sha1",
  repoOwner: "acme",
  repoName: "widgets",
  action: "opened",
  branch: "main",
  prNumber: 5,
};

function resetMocks() {
  process.env.BACKGROUND_AGENTS_ENABLED = "true";
  delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
  matchingRows = [];
  createRunResult = { created: true, run: { id: "run-new" } };
  start.mockClear();
  createRunForTrigger.mockClear();
  recordBackgroundAgentEvent.mockClear();
  updateBackgroundAgentRunStatus.mockClear();
  listMatchingTriggersForEvent.mockClear();
}

describe("dispatchBackgroundTriggerEvent — TASK-168 event trigger scenarios", () => {
  beforeEach(() => {
    resetMocks();
  });

  // BT-168-MATCH-007: Matching event creates exactly one run
  test("BT-168-MATCH-007: matching GitHub event creates exactly one run and starts workflow", async () => {
    matchingRows = [{ agent: baseAgent, trigger: baseAgent.triggers[0]! }];
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: prEvent,
      requestId: "req-match",
    });

    expect(result.created).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.runIds).toHaveLength(1);
    expect(result.runIds[0]).toBe("run-new");
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  // BT-168-MATCH-002 (dispatcher level): No matching triggers → no run created
  test("BT-168-MATCH-002 (dispatcher): no matching triggers means zero runs created", async () => {
    matchingRows = []; // no matching triggers
    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: prEvent,
      requestId: "req-no-match",
    });

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.runIds).toHaveLength(0);
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  // BT-168-MATCH-008: Duplicate webhook delivery → idempotency returns existing run, no workflow started
  test("BT-168-MATCH-008: duplicate webhook delivery returns existing run and does NOT start a second workflow", async () => {
    matchingRows = [{ agent: baseAgent, trigger: baseAgent.triggers[0]! }];
    // Simulate idempotency: createRunForTrigger returns created: false (duplicate)
    createRunResult = { created: false, run: { id: "run-existing" } };

    const { dispatchBackgroundTriggerEvent } = await dispatcherModulePromise;

    const result = await dispatchBackgroundTriggerEvent({
      event: prEvent,
      requestId: "req-duplicate",
    });

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.runIds).toEqual(["run-existing"]);
    // Workflow must NOT be started for a duplicate
    expect(start).not.toHaveBeenCalled();
    // No event recorded for duplicate
    expect(recordBackgroundAgentEvent).not.toHaveBeenCalled();
  });
});
