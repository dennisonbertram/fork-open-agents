/**
 * REGRESSION tests: "one bad run does not wedge the schedule" and
 * "duplicate dispatch does not double-start".
 *
 * These tests would FAIL if the implementation in feat: TASK-164 (88dd2e5f) is reverted.
 *
 * Regression scenarios covered:
 * - REGRESSION-001: workflow start failure still advances schedule state
 * - REGRESSION-002: duplicate idempotency key does not start workflow twice
 * - REGRESSION-003: invalid schedule records a skip reason (no crash, no false dispatch)
 * - REGRESSION-004: computeNextRuns returns strictly-future dates (never current minute)
 * - REGRESSION-005: validateSchedule distinguishes 5-field from 6-field cron expressions
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentWithTriggers } from "./store";
import { computeNextRuns, validateSchedule } from "./schedule-presets";

// ── Pure helper regressions (no mocking needed) ─────────────────────────────

describe("REGRESSION: computeNextRuns never returns the current minute", () => {
  test("REGRESSION-004: strictly after fromDate — exact current minute excluded", () => {
    // If a run fires at 09:00, computeNextRuns must NOT include 09:00 itself
    const atExactMatch = new Date("2026-06-01T09:00:00.000Z");
    const runs = computeNextRuns("0 9 * * *", atExactMatch, 3);
    for (const run of runs) {
      expect(run.getTime()).toBeGreaterThan(atExactMatch.getTime());
    }
    // Next one should be the following day at 09:00
    expect(runs[0]?.getUTCDate()).toBe(2);
  });

  test("REGRESSION-004: 1 second before the match minute is included in next runs", () => {
    // If we ask 1 second before 09:00, 09:00 today should be the first run
    const justBefore = new Date("2026-06-01T08:59:59.000Z");
    const runs = computeNextRuns("0 9 * * *", justBefore, 1);
    expect(runs[0]?.getUTCHours()).toBe(9);
    expect(runs[0]?.getUTCMinutes()).toBe(0);
    expect(runs[0]?.getUTCDate()).toBe(1); // same day
  });
});

describe("REGRESSION: validateSchedule correctly distinguishes field counts", () => {
  test("REGRESSION-005: 5-field cron is valid", () => {
    const result = validateSchedule("0 9 * * 1-5");
    expect(result.valid).toBe(true);
  });

  test("REGRESSION-005: 6-field cron (with seconds) is invalid — not supported", () => {
    const result = validateSchedule("0 0 9 * * 1-5");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/5.*field|requires exactly 5/i);
    }
  });

  test("REGRESSION-005: @hourly, @daily, @weekly shortcuts are valid", () => {
    expect(validateSchedule("@hourly").valid).toBe(true);
    expect(validateSchedule("@daily").valid).toBe(true);
    expect(validateSchedule("@weekly").valid).toBe(true);
  });
});

// ── Dispatcher regressions (mocked) ──────────────────────────────────────────

mock.module("server-only", () => ({}));

const advanceTriggerScheduleStateMock = mock(async () => undefined);
const recordTriggerSkipReasonMock = mock(async () => undefined);

let workflowRunId: string | null = "wf-regression-1";
const startMock = mock(async () => ({ runId: workflowRunId }));
const createRunForTriggerMock = mock(async () => ({
  created: true,
  run: { id: "run-regression-1" },
}));
const recordBackgroundAgentEventMock = mock(async () => undefined);
const updateBackgroundAgentRunStatusMock = mock(async () => undefined);

let scheduleRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];

mock.module("workflow/api", () => ({ start: startMock }));
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
  advanceTriggerScheduleState: advanceTriggerScheduleStateMock,
  countRecentRunsForTarget: async () => 0,
  createRunForTrigger: createRunForTriggerMock,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId: async () => null,
  listEnabledScheduleTriggers: mock(async () => scheduleRows),
  listStaleBackgroundAgentRuns: mock(async () => []),
  listMatchingTriggersForEvent: async () => [],
  recordBackgroundAgentEvent: recordBackgroundAgentEventMock,
  recordTriggerSkipReason: recordTriggerSkipReasonMock,
  updateBackgroundAgentRunStatus: updateBackgroundAgentRunStatusMock,
}));

const dispatcherModulePromise = import("./dispatcher");

const regressionAgent: BackgroundAgentWithTriggers = {
  id: "agent-regression",
  userId: "user-regression",
  name: "Regression test agent",
  repoOwner: "acme",
  repoName: "regression",
  description: null,
  status: "enabled",
  instructions: "Regression test.",
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
  runBudgetPerTarget: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  triggers: [],
};

const regressionTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  id: "trigger-regression",
  agentId: "agent-regression",
  loopId: null,
  userId: "user-regression",
  name: "Every minute",
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

function resetRegressionMocks() {
  process.env.BACKGROUND_AGENTS_ENABLED = "true";
  delete process.env.BACKGROUND_AGENTS_ALLOWED_REPOS;
  workflowRunId = "wf-regression-1";
  scheduleRows = [];
  startMock.mockClear();
  startMock.mockImplementation(async () => ({ runId: workflowRunId }));
  createRunForTriggerMock.mockClear();
  createRunForTriggerMock.mockImplementation(async () => ({
    created: true,
    run: { id: "run-regression-1" },
  }));
  recordBackgroundAgentEventMock.mockClear();
  updateBackgroundAgentRunStatusMock.mockClear();
  advanceTriggerScheduleStateMock.mockClear();
  recordTriggerSkipReasonMock.mockClear();
}

describe("REGRESSION: schedule does not get wedged", () => {
  beforeEach(resetRegressionMocks);

  test("REGRESSION-001: workflow start failure still advances schedule state (no wedge)", async () => {
    // If this regresses: schedule state is NOT advanced when workflow start fails,
    // causing the agent to never run again until manually reset.
    scheduleRows = [{ agent: regressionAgent, trigger: regressionTrigger }];
    workflowRunId = null; // simulate workflow start failure
    startMock.mockImplementation(async () => ({ runId: null }));

    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T10:00:00.000Z"),
      requestId: "req-regression-1",
    });

    // Schedule state MUST advance even after workflow start failure
    expect(advanceTriggerScheduleStateMock).toHaveBeenCalledTimes(1);
    expect(advanceTriggerScheduleStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ triggerId: "trigger-regression" }),
    );
    // Workflow start failure should have been recorded
    expect(updateBackgroundAgentRunStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorKind: "workflow_failed",
      }),
    );
  });

  test("REGRESSION-002: duplicate dispatch does not double-start the workflow", async () => {
    // If this regresses: a second invocation for the same minute starts a second workflow run.
    scheduleRows = [{ agent: regressionAgent, trigger: regressionTrigger }];
    // First call: new run created
    createRunForTriggerMock.mockImplementationOnce(async () => ({
      created: true,
      run: { id: "run-regression-2" },
    }));
    // Second call (same trigger, same minute bucket): duplicate — run already exists
    createRunForTriggerMock.mockImplementationOnce(async () => ({
      created: false,
      run: { id: "run-regression-2" },
    }));

    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T10:01:00.000Z");

    // First dispatch
    const r1 = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-r2a",
    });
    // Second dispatch same minute
    const r2 = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-r2b",
    });

    expect(r1.created).toBe(1);
    expect(r2.duplicates).toBe(1);
    expect(r2.created).toBe(0);
    // Workflow must only have been started ONCE
    expect(startMock).toHaveBeenCalledTimes(1);
    // But schedule state should advance on both invocations
    expect(advanceTriggerScheduleStateMock).toHaveBeenCalledTimes(2);
  });

  test("REGRESSION-003: invalid schedule records a skip reason and starts no run", async () => {
    // If this regresses: invalid schedule either crashes or silently drops skip tracking.
    const invalidTrigger = {
      ...regressionTrigger,
      id: "trigger-invalid-regression",
      schedule: "not valid cron at all",
    };
    scheduleRows = [{ agent: regressionAgent, trigger: invalidTrigger }];

    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const result = await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T10:02:00.000Z"),
      requestId: "req-regression-3",
    });

    // No run created
    expect(createRunForTriggerMock).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    // Skip reason must be recorded
    expect(recordTriggerSkipReasonMock).toHaveBeenCalledWith(
      expect.objectContaining({ triggerId: "trigger-invalid-regression" }),
    );
  });
});
