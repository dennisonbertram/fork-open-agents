/**
 * Regression tests for TASK-ISSUE-74: durable managed_runtime_worker_runs.
 *
 * These tests cover mutation-catchers for:
 *   R-001: dedup key — two calls with the same (sessionId, taskToolCallId)
 *          must use onConflictDoUpdate (not a raw re-insert)
 *   R-002: redaction must always be called on a non-null summary
 *   R-003: toManagedRuntimeWorkerSnapshot always emits source "durable"
 *   R-005: persistWorkerRunBestEffort always returns void
 *
 * R-004 (durable-first route preference) is covered in route.test.ts.
 *
 * These tests FAIL if the green commit (f3a3e56e) is reverted.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const insertMock = mock(() => ({
  values: mock(() => ({
    onConflictDoUpdate: mock(() => ({
      returning: mock(() =>
        Promise.resolve([
          {
            id: "wrun_r1",
            sessionId: "session-r",
            chatId: null,
            userId: "user-r",
            workflowRunId: null,
            taskToolCallId: "task-r1",
            workerType: "executor",
            status: "completed",
            sandboxName: null,
            profileId: null,
            profileVersion: null,
            profileDisplayName: null,
            profileRunId: null,
            toolCallCount: 2,
            summary: null,
            startedAt: null,
            finishedAt: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ]),
      ),
    })),
  })),
}));

const redactHarnessValueMock = mock((v: unknown, _field: string) => {
  if (typeof v !== "string") return v;
  return v.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_TOKEN]");
});

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
  redactHarnessValue: redactHarnessValueMock,
}));

// Mock events module — event emission is tested separately in event.test.ts
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: mock(() => Promise.resolve(null)),
  recordSessionEvent: mock(() => Promise.resolve(null)),
  listSessionEvents: mock(() => Promise.resolve([])),
  toSessionEventSnapshot: mock((e: unknown) => e),
}));

const {
  recordManagedRuntimeWorkerRun,
  persistWorkerRunBestEffort,
  toManagedRuntimeWorkerSnapshot,
} = await import("./managed-runtime-worker-runs");

describe("regression: managed_runtime_worker_runs", () => {
  beforeEach(() => {
    insertMock.mockClear();
    redactHarnessValueMock.mockClear();
  });

  test("R-001: each recordManagedRuntimeWorkerRun call uses upsert path (onConflictDoUpdate)", async () => {
    // Call twice with same sessionId + taskToolCallId (dedup key)
    await recordManagedRuntimeWorkerRun({
      sessionId: "session-r",
      chatId: null,
      userId: "user-r",
      workflowRunId: null,
      taskToolCallId: "task-r1",
      workerType: "executor",
      status: "running",
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

    await recordManagedRuntimeWorkerRun({
      sessionId: "session-r",
      chatId: null,
      userId: "user-r",
      workflowRunId: null,
      taskToolCallId: "task-r1",
      workerType: "executor",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 3,
      summary: null,
      startedAt: null,
      finishedAt: null,
    });

    // insert was called for each call (the upsert path)
    expect(insertMock).toHaveBeenCalledTimes(2);
    // If onConflictDoUpdate were removed, the mock structure would break
    // and the test would fail with a different error — catching the regression.
  });

  test("R-002: redactHarnessValue is called on a non-null summary before persisting", async () => {
    const sensitiveTask = "Deploy sk-1234567890abcdef to production";

    await recordManagedRuntimeWorkerRun({
      sessionId: "session-r",
      chatId: null,
      userId: "user-r",
      workflowRunId: null,
      taskToolCallId: "task-r2",
      workerType: "worker",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 0,
      summary: sensitiveTask,
      startedAt: null,
      finishedAt: null,
    });

    // Redaction must have been called with the exact summary string
    expect(redactHarnessValueMock).toHaveBeenCalledWith(
      sensitiveTask,
      "summary",
    );
  });

  test("R-003: toManagedRuntimeWorkerSnapshot always emits source durable, never message", () => {
    const row = {
      id: "wrun_r3",
      sessionId: "session-r",
      chatId: null,
      userId: "user-r",
      workflowRunId: null,
      taskToolCallId: "task-r3",
      workerType: "executor",
      status: "completed" as const,
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 1,
      summary: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    };

    const snapshot = toManagedRuntimeWorkerSnapshot(row);

    // Critical regression guard: if someone accidentally changes this back to
    // "message", this assertion fails immediately.
    expect(snapshot.source).toBe("durable");
    expect(snapshot.source).not.toBe("message");
  });

  test("R-005: persistWorkerRunBestEffort always returns void (not the row)", async () => {
    const result = await persistWorkerRunBestEffort({
      sessionId: "session-r",
      chatId: null,
      userId: "user-r",
      workflowRunId: null,
      taskToolCallId: "task-r5",
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
    });

    // Must return undefined, not a DB row
    expect(result).toBeUndefined();
  });
});
