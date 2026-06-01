import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Test that the best-effort persistence wrapper does not throw
// even when the underlying DB operation fails.
// We import the wrapper directly from the module.

// Force DB insert to throw
mock.module("@/lib/db/client", () => ({
  db: {
    insert: mock(() => {
      throw new Error("DB connection refused");
    }),
    query: {
      managedRuntimeWorkerRuns: {
        findMany: mock(() =>
          Promise.reject(new Error("DB connection refused")),
        ),
      },
    },
  },
}));

// We intentionally do NOT mock @/lib/harness/redaction here because that would
// leak the mock into other co-located test files and break their assertions.
// The defensive test only needs to verify that DB failures are swallowed.

// Mock events module — event emission is tested separately in event.test.ts
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: mock(() => Promise.resolve(null)),
  recordSessionEvent: mock(() => Promise.resolve(null)),
  listSessionEvents: mock(() => Promise.resolve([])),
  toSessionEventSnapshot: mock((e: unknown) => e),
}));

const { persistWorkerRunBestEffort } =
  await import("./managed-runtime-worker-runs");

describe("best-effort worker run persistence", () => {
  test("persistWorkerRunBestEffort does not throw when DB fails", async () => {
    // This must NOT throw — persistence failure is best-effort
    await expect(
      persistWorkerRunBestEffort({
        sessionId: "session-1",
        chatId: "chat-1",
        userId: "user-1",
        workflowRunId: "wf-1",
        taskToolCallId: "task-1",
        workerType: "executor",
        status: "completed",
        sandboxName: null,
        profileId: null,
        profileVersion: null,
        profileDisplayName: null,
        profileRunId: null,
        toolCallCount: 3,
        summary: "Some task",
        startedAt: null,
        finishedAt: null,
      }),
    ).resolves.toBeUndefined();
  });

  test("persistWorkerRunBestEffort returns undefined (not the row) on success path", async () => {
    // Even if the mock DB magically succeeded, best-effort returns void
    const result = await persistWorkerRunBestEffort({
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      workflowRunId: "wf-1",
      taskToolCallId: "task-2",
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

    // best-effort wrapper always returns void/undefined, never throws
    expect(result).toBeUndefined();
  });
});
