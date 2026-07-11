/**
 * Tests for persisted schedule state advancement in dispatchScheduledBackgroundAgents.
 * BT-003: Enabled+due trigger → exactly ONE run created; schedule state advances.
 * BT-004: Duplicate/concurrent dispatch → duplicate prevented; next_run_at advances.
 * BT-005: Disabled / not-due / invalid / repo-disallowed → skip reason recorded.
 * BT-006: Failed run → schedule state still advances (no wedge).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentRun } from "@/lib/db/schema";
import type { BackgroundAgentWithTriggers } from "./store";

mock.module("server-only", () => ({}));

const advanceTriggerScheduleState = mock(async () => undefined);
const recordTriggerSkipReason = mock(async () => undefined);

let workflowRunId: string | null = "workflow-run-1";
const start = mock(async () => ({ runId: workflowRunId }));

const createRunForTriggerMock = mock(async () => ({
  created: true,
  run: { id: "run-schedule-1" },
}));
const recordBackgroundAgentEventMock = mock(async () => undefined);
const listEnabledScheduleTriggersMock = mock(async () => scheduleRows);
const listStaleBackgroundAgentRunsMock = mock(
  async (): Promise<BackgroundAgentRun[]> => [],
);
const updateBackgroundAgentRunStatusMock = mock(async () => undefined);

let scheduleRows: Array<{
  agent: BackgroundAgentWithTriggers;
  trigger: BackgroundAgentWithTriggers["triggers"][number];
}> = [];

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

const seedTriggerNextRunAt = mock(async () => undefined);

mock.module("./store", () => ({
  countRecentRunsForTarget: async () => 0,
  createRunForTrigger: createRunForTriggerMock,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId: async () => null,
  listEnabledScheduleTriggers: listEnabledScheduleTriggersMock,
  listStaleBackgroundAgentRuns: listStaleBackgroundAgentRunsMock,
  listMatchingTriggersForEvent: async () => [],
  recordBackgroundAgentEvent: recordBackgroundAgentEventMock,
  updateBackgroundAgentRunStatus: updateBackgroundAgentRunStatusMock,
  advanceTriggerScheduleState,
  recordTriggerSkipReason,
  seedTriggerNextRunAt,
}));

const dispatcherModulePromise = import("./dispatcher");

const baseAgent: BackgroundAgentWithTriggers = {
  id: "agent-sched",
  userId: "user-sched",
  name: "Schedule test agent",
  repoOwner: "acme",
  repoName: "scheduler",
  description: null,
  status: "enabled",
  instructions: "Run schedule checks.",
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
  triggers: [],
};

const scheduleTrigger: BackgroundAgentWithTriggers["triggers"][number] = {
  id: "trigger-sched-1",
  agentId: "agent-sched",
  loopId: null,
  userId: "user-sched",
  name: "Every minute",
  kind: "schedule.cron",
  status: "enabled",
  conditions: {},
  schedule: "* * * * *",
  webhookPublicId: null,
  webhookSecretHash: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
};

function resetMocks() {
  process.env.BACKGROUND_AGENTS_ENABLED = "true";
  process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "*";
  workflowRunId = "workflow-run-1";
  scheduleRows = [];
  start.mockClear();
  start.mockImplementation(async () => ({ runId: workflowRunId }));
  createRunForTriggerMock.mockClear();
  createRunForTriggerMock.mockImplementation(async () => ({
    created: true,
    run: { id: "run-schedule-1" },
  }));
  recordBackgroundAgentEventMock.mockClear();
  updateBackgroundAgentRunStatusMock.mockClear();
  seedTriggerNextRunAt.mockClear();
  listEnabledScheduleTriggersMock.mockClear();
  listEnabledScheduleTriggersMock.mockImplementation(async () => scheduleRows);
  listStaleBackgroundAgentRunsMock.mockClear();
  listStaleBackgroundAgentRunsMock.mockImplementation(async () => []);
  advanceTriggerScheduleState.mockClear();
  recordTriggerSkipReason.mockClear();
}

describe("dispatchScheduledBackgroundAgents — persisted schedule state", () => {
  beforeEach(resetMocks);

  test("BT-003: advances schedule state after exactly one run is created", async () => {
    scheduleRows = [{ agent: baseAgent, trigger: scheduleTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T09:00:00.000Z");

    await dispatchScheduledBackgroundAgents({ now, requestId: "req-state-1" });

    expect(createRunForTriggerMock).toHaveBeenCalledTimes(1);
    // BT-003: schedule state must be advanced after a run is created
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-sched-1",
        lastRunAt: now,
      }),
    );
  });

  test("BT-004: advances next_run_at even on duplicate dispatch (no double-start)", async () => {
    scheduleRows = [{ agent: baseAgent, trigger: scheduleTrigger }];
    // Simulate a duplicate — run already existed
    createRunForTriggerMock.mockImplementationOnce(async () => ({
      created: false,
      run: { id: "run-existing" },
    }));
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T09:00:00.000Z");

    const result = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-dup",
    });

    expect(result.duplicates).toBe(1);
    expect(result.created).toBe(0);
    // Workflow must NOT be started again
    expect(start).not.toHaveBeenCalled();
    // BT-004: next_run_at still advances even on duplicate
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-sched-1",
        lastRunAt: now,
      }),
    );
  });

  test("BT-005: records skip reason when trigger has invalid schedule", async () => {
    const invalidTrigger = {
      ...scheduleTrigger,
      id: "trigger-invalid",
      schedule: "not a cron expression",
    };
    // The dispatcher itself filters by scheduleMatchesNow — invalid schedule
    // won't match, so the row won't enter the dispatch loop.
    // We test the skip-reason recording by providing a trigger that
    // was fetched but fails validation in the dispatcher.
    // For this test: rows returns the trigger, but scheduleMatchesNow returns false
    scheduleRows = [{ agent: baseAgent, trigger: invalidTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-invalid",
    });

    // No run created for invalid schedule
    expect(createRunForTriggerMock).not.toHaveBeenCalled();
    // BT-005: skip reason should be recorded for invalid schedule
    expect(recordTriggerSkipReason).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-invalid",
        skipReason: expect.stringContaining("schedule"),
      }),
    );
  });

  test("BT-750-E: legacy null-nextRunAt off-grid trigger is seeded on sweep instead of never firing", async () => {
    // Pre-#750 rows have nextRunAt null. An off-grid schedule ('7 * * * *')
    // can never exact-minute match a */5 tick, so without seeding it would
    // never fire. The sweep must persist a seeded nextRunAt so the NEXT
    // sweep after that time fires it via the due-window path.
    const legacyTrigger = {
      ...scheduleTrigger,
      id: "trigger-legacy-offgrid",
      schedule: "7 * * * *",
      nextRunAt: null,
    };
    scheduleRows = [{ agent: baseAgent, trigger: legacyTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    // Tick at 09:12 UTC — minute 12 does not match minute 7, no run yet.
    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:12:00.000Z"),
      requestId: "req-legacy-seed",
    });

    expect(createRunForTriggerMock).not.toHaveBeenCalled();
    // Seeded to the next matching minute after 09:12 → 10:07 UTC.
    expect(seedTriggerNextRunAt).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-legacy-offgrid",
        nextRunAt: new Date("2026-06-01T10:07:00.000Z"),
      }),
    );
    // Not-due is NOT a skip reason.
    expect(recordTriggerSkipReason).not.toHaveBeenCalled();
  });

  test("BT-750-F: invalid schedule records an actionable skip reason, not the not-due message", async () => {
    const invalidTrigger = {
      ...scheduleTrigger,
      id: "trigger-invalid-msg",
      schedule: "not a cron expression",
    };
    scheduleRows = [{ agent: baseAgent, trigger: invalidTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-invalid-msg",
    });

    expect(recordTriggerSkipReason).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-invalid-msg",
        skipReason: "invalid schedule expression",
      }),
    );
    // Invalid schedules are never seeded.
    expect(seedTriggerNextRunAt).not.toHaveBeenCalled();
  });

  test("BT-005: records skip reason when repo is not in allowlist", async () => {
    process.env.BACKGROUND_AGENTS_ALLOWED_REPOS = "acme/other";
    scheduleRows = [{ agent: baseAgent, trigger: scheduleTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-allowlist",
    });

    expect(createRunForTriggerMock).not.toHaveBeenCalled();
    // BT-005: skip reason for repo not allowed
    expect(recordTriggerSkipReason).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-sched-1",
        skipReason: expect.stringContaining("repo"),
      }),
    );
  });

  test("BT-006: schedule state advances even when workflow start fails (no wedge)", async () => {
    scheduleRows = [{ agent: baseAgent, trigger: scheduleTrigger }];
    workflowRunId = null; // simulate workflow start failure
    start.mockImplementation(async () => ({ runId: null }));
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T09:00:00.000Z");

    const result = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-fail",
    });

    // Run was created even though workflow start failed
    expect(result.created).toBe(1);
    // BT-006: schedule state must still advance
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-sched-1",
        lastRunAt: now,
      }),
    );
  });

  test("catches up a missed schedule window using the persisted next_run_at", async () => {
    const missedDueAt = new Date("2026-06-01T08:59:00.000Z");
    scheduleRows = [
      {
        agent: baseAgent,
        trigger: { ...scheduleTrigger, nextRunAt: missedDueAt },
      },
    ];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:02:00.000Z"),
      requestId: "req-catch-up",
    });

    expect(createRunForTriggerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          externalId: "trigger-sched-1:2026-06-01T08:59",
          occurredAt: "2026-06-01T08:59:00.000Z",
        }),
      }),
    );
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-sched-1",
        lastRunAt: missedDueAt,
      }),
    );
  });

  test("BT-750-off-grid: trigger with nextRunAt in the past fires on an off-grid tick", async () => {
    // now = 09:12 for a "7 * * * *" schedule (due at :07). The platform cron
    // tick runs every 5 minutes and will not always land exactly on :07 — the
    // dispatcher must fire because nextRunAt <= now, not because the current
    // minute matches the cron expression exactly.
    const offGridTrigger = {
      ...scheduleTrigger,
      id: "trigger-off-grid",
      schedule: "7 * * * *",
      nextRunAt: new Date("2026-06-01T09:07:00.000Z"),
    };
    scheduleRows = [{ agent: baseAgent, trigger: offGridTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T09:12:00.000Z");

    const result = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-off-grid",
    });

    expect(result.created).toBe(1);
    expect(createRunForTriggerMock).toHaveBeenCalledTimes(1);
    expect(advanceTriggerScheduleState).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "trigger-off-grid",
        lastRunAt: new Date("2026-06-01T09:07:00.000Z"),
      }),
    );
  });

  test("BT-750-no-skip: an ordinary not-due trigger does not get lastSkipReason recorded", async () => {
    // A trigger whose nextRunAt is in the future should be silently skipped —
    // recording a skip reason on nearly every sweep makes the schedule card
    // render a permanent amber warning even though nothing is wrong.
    const notDueTrigger = {
      ...scheduleTrigger,
      id: "trigger-not-due",
      schedule: "0 9 * * *",
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
    };
    scheduleRows = [{ agent: baseAgent, trigger: notDueTrigger }];
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;
    const now = new Date("2026-06-01T09:12:00.000Z");

    const result = await dispatchScheduledBackgroundAgents({
      now,
      requestId: "req-not-due",
    });

    expect(result.created).toBe(0);
    expect(createRunForTriggerMock).not.toHaveBeenCalled();
    expect(recordTriggerSkipReason).not.toHaveBeenCalled();
  });

  test("terminalizes stale queued or running background-agent runs", async () => {
    const staleRun: BackgroundAgentRun = {
      id: "run-stale",
      agentId: "agent-sched",
      triggerId: "trigger-sched-1",
      userId: "user-sched",
      status: "running",
      source: "schedule",
      triggerKind: "schedule.cron",
      externalId: "trigger-sched-1:2026-06-01T06:00",
      idempotencyKey: "key",
      repoOwner: "acme",
      repoName: "scheduler",
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
      workflowRunId: "workflow-stale",
      requestId: "req-old",
      startedAt: new Date("2026-06-01T06:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-06-01T06:00:00.000Z"),
      updatedAt: new Date("2026-06-01T06:00:00.000Z"),
    };
    listStaleBackgroundAgentRunsMock.mockImplementationOnce(async () => [
      staleRun,
    ]);
    const { dispatchScheduledBackgroundAgents } = await dispatcherModulePromise;

    await dispatchScheduledBackgroundAgents({
      now: new Date("2026-06-01T09:00:00.000Z"),
      requestId: "req-sweep",
    });

    // #743: the sweeper must pass force:true — a swept "stuck" run may have
    // already reached a terminal status via a race with its own executor,
    // and the sweeper's terminalization must not be silently refused by the
    // new terminal-status guard.
    expect(updateBackgroundAgentRunStatusMock).toHaveBeenCalledWith({
      runId: "run-stale",
      status: "failed",
      errorKind: "stuck_running",
      errorMessage:
        "Background agent run exceeded the stale threshold and was swept by cron.",
      force: true,
      agentId: "agent-sched",
      userId: "user-sched",
    });
    expect(recordBackgroundAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-stale",
        eventName: "background-agent.run.swept_stale",
        errorKind: "stuck_running",
        workflowRunId: "workflow-stale",
        sandboxName: "sandbox-stale",
      }),
    );
  });
});
