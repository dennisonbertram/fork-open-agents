/**
 * RED tests for FIX 2 (TASK-ISSUE-74): managed_runtime.worker.recorded event.
 *
 * DoD requirement: emit a structured observability event on successful persist.
 * Event name: "managed_runtime.worker.recorded"
 * Fields: runId, sandboxName, profileId, workerType (agentRole), status,
 *         plus correlation ids (sessionId, chatId, userId, workflowRunId).
 * Must be best-effort (never throws into chat).
 * Must use emitSessionEvent from @/lib/observability/events (matches sibling pattern).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- DB insert mock ----
const returningMock = mock(() =>
  Promise.resolve([
    {
      id: "wrun_event_test",
      sessionId: "session-ev",
      chatId: "chat-ev",
      userId: "user-ev",
      workflowRunId: "wf-ev",
      taskToolCallId: "task-ev-1",
      workerType: "executor",
      status: "completed",
      sandboxName: "sbx_ev",
      profileId: "web-bun-agent-browser",
      profileVersion: "2026-05-23.2",
      profileDisplayName: "Web app with Bun",
      profileRunId: "mprun_ev",
      toolCallCount: 4,
      summary: "Deploy feature",
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      finishedAt: new Date("2026-06-01T10:05:00.000Z"),
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:05:00.000Z"),
    },
  ]),
);

const onConflictDoUpdateMock = mock(() => ({ returning: returningMock }));
const valuesMock = mock(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
const insertMock = mock(() => ({ values: valuesMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    query: {
      managedRuntimeWorkerRuns: {
        findMany: mock(() => Promise.resolve([])),
      },
    },
  },
}));

mock.module("@/lib/harness/redaction", () => ({
  redactHarnessValue: mock((v: unknown) => v),
}));

// ---- emitSessionEvent mock ----
const emitSessionEventMock = mock(() =>
  Promise.resolve({
    id: "evt_test",
    sessionId: "session-ev",
    eventName: "managed_runtime.worker.recorded",
    status: "info",
    createdAt: new Date(),
  }),
);

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: emitSessionEventMock,
  recordSessionEvent: mock(() => Promise.resolve(null)),
}));

const { recordManagedRuntimeWorkerRun, persistWorkerRunBestEffort } =
  await import("./managed-runtime-worker-runs");

describe("managed_runtime.worker.recorded event emission", () => {
  beforeEach(() => {
    insertMock.mockClear();
    emitSessionEventMock.mockClear();
  });

  test("BT-EV-001: recordManagedRuntimeWorkerRun emits managed_runtime.worker.recorded event after persist", async () => {
    await recordManagedRuntimeWorkerRun({
      sessionId: "session-ev",
      chatId: "chat-ev",
      userId: "user-ev",
      workflowRunId: "wf-ev",
      taskToolCallId: "task-ev-1",
      workerType: "executor",
      status: "completed",
      sandboxName: "sbx_ev",
      profileId: "web-bun-agent-browser",
      profileVersion: "2026-05-23.2",
      profileDisplayName: "Web app with Bun",
      profileRunId: "mprun_ev",
      toolCallCount: 4,
      summary: "Deploy feature",
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      finishedAt: new Date("2026-06-01T10:05:00.000Z"),
    });

    // emitSessionEvent must have been called
    expect(emitSessionEventMock).toHaveBeenCalledTimes(1);

    // Must use the correct event name
    const callArg = emitSessionEventMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.eventName).toBe("managed_runtime.worker.recorded");
  });

  test("BT-EV-002: emitted event contains the correct correlation ids and worker fields (redacted)", async () => {
    await recordManagedRuntimeWorkerRun({
      sessionId: "session-ev",
      chatId: "chat-ev",
      userId: "user-ev",
      workflowRunId: "wf-ev",
      taskToolCallId: "task-ev-1",
      workerType: "executor",
      status: "completed",
      sandboxName: "sbx_ev",
      profileId: "web-bun-agent-browser",
      profileVersion: "2026-05-23.2",
      profileDisplayName: "Web app with Bun",
      profileRunId: "mprun_ev",
      toolCallCount: 4,
      summary: "Deploy feature",
      startedAt: null,
      finishedAt: null,
    });

    const callArg = emitSessionEventMock.mock.calls[0][0] as Record<string, unknown>;

    // Correlation ids must be present
    expect(callArg.sessionId).toBe("session-ev");
    expect(callArg.chatId).toBe("chat-ev");
    expect(callArg.userId).toBe("user-ev");
    expect(callArg.workflowRunId).toBe("wf-ev");

    // Worker-identifying fields must appear in payload
    const payload = callArg.payload as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(payload.workerType).toBe("executor");
    expect(payload.status).toBe("completed");
    expect(payload.sandboxName).toBe("sbx_ev");
    expect(payload.profileId).toBe("web-bun-agent-browser");
  });

  test("BT-EV-003: event emission is best-effort — emit failure does not throw from recordManagedRuntimeWorkerRun", async () => {
    emitSessionEventMock.mockImplementation(() =>
      Promise.reject(new Error("event sink unavailable")),
    );

    // Must NOT throw even when emitSessionEvent rejects
    await expect(
      recordManagedRuntimeWorkerRun({
        sessionId: "session-ev",
        chatId: null,
        userId: "user-ev",
        workflowRunId: null,
        taskToolCallId: "task-ev-3",
        workerType: "worker",
        status: "running",
        sandboxName: null,
        profileId: null,
        profileVersion: null,
        profileDisplayName: null,
        profileRunId: null,
        toolCallCount: 0,
        summary: null,
        startedAt: null,
        finishedAt: null,
      }),
    ).resolves.toBeDefined();
  });

  test("BT-EV-004: persistWorkerRunBestEffort emits managed_runtime.worker.recorded on success", async () => {
    emitSessionEventMock.mockImplementation(() =>
      Promise.resolve({
        id: "evt_best_effort",
        sessionId: "session-ev",
        eventName: "managed_runtime.worker.recorded",
        status: "info",
        createdAt: new Date(),
      }),
    );

    await persistWorkerRunBestEffort({
      sessionId: "session-ev",
      chatId: "chat-ev",
      userId: "user-ev",
      workflowRunId: null,
      taskToolCallId: "task-ev-4",
      workerType: "executor",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 1,
      summary: null,
      startedAt: null,
      finishedAt: null,
    });

    // The event should have been emitted even through the best-effort wrapper
    expect(emitSessionEventMock).toHaveBeenCalledTimes(1);
    const callArg = emitSessionEventMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.eventName).toBe("managed_runtime.worker.recorded");
  });
});
