import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Mock the DB client
const insertMock = mock(() => ({
  values: mock(() => ({
    onConflictDoUpdate: mock(() => ({
      returning: mock(() =>
        Promise.resolve([
          {
            id: "wrun_test1",
            sessionId: "session-1",
            chatId: "chat-1",
            userId: "user-1",
            workflowRunId: "wf-1",
            taskToolCallId: "task-tool-call-1",
            workerType: "executor",
            status: "completed",
            sandboxName: "sbx_1",
            profileId: "web-bun-agent-browser",
            profileVersion: "2026-05-23.2",
            profileDisplayName: "Web app with Bun",
            profileRunId: "mprun_1",
            toolCallCount: 5,
            summary: "Implement a feature",
            startedAt: new Date("2026-06-01T10:00:00.000Z"),
            finishedAt: new Date("2026-06-01T10:05:00.000Z"),
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:05:00.000Z"),
          },
        ]),
      ),
    })),
  })),
}));

const findManyMock = mock(() =>
  Promise.resolve([
    {
      id: "wrun_test1",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      workflowRunId: "wf-1",
      taskToolCallId: "task-tool-call-1",
      workerType: "executor",
      status: "completed",
      sandboxName: "sbx_1",
      profileId: "web-bun-agent-browser",
      profileVersion: "2026-05-23.2",
      profileDisplayName: "Web app with Bun",
      profileRunId: "mprun_1",
      toolCallCount: 5,
      summary: "Implement a feature",
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      finishedAt: new Date("2026-06-01T10:05:00.000Z"),
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:05:00.000Z"),
    },
  ]),
);

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    query: {
      managedRuntimeWorkerRuns: {
        findMany: findManyMock,
      },
    },
  },
}));

mock.module("@/lib/harness/redaction", () => ({
  redactHarnessValue: mock((value: unknown, _field: string) => {
    if (typeof value !== "string") return value;
    // Simulate redaction of secrets
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_TOKEN]")
      .replace(
        /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=[^\s]+/g,
        (m) => m.split("=")[0] + "=[REDACTED]",
      );
  }),
}));

const {
  recordManagedRuntimeWorkerRun,
  listManagedRuntimeWorkerRunsForSession,
  toManagedRuntimeWorkerSnapshot,
} = await import("./managed-runtime-worker-runs");

describe("managed runtime worker runs persistence", () => {
  beforeEach(() => {
    insertMock.mockClear();
    findManyMock.mockClear();
  });

  describe("recordManagedRuntimeWorkerRun", () => {
    test("upserts by (sessionId, taskToolCallId) and returns the row", async () => {
      const row = await recordManagedRuntimeWorkerRun({
        sessionId: "session-1",
        chatId: "chat-1",
        userId: "user-1",
        workflowRunId: "wf-1",
        taskToolCallId: "task-tool-call-1",
        workerType: "executor",
        status: "completed",
        sandboxName: "sbx_1",
        profileId: "web-bun-agent-browser",
        profileVersion: "2026-05-23.2",
        profileDisplayName: "Web app with Bun",
        profileRunId: "mprun_1",
        toolCallCount: 5,
        summary: "Implement a feature",
        startedAt: new Date("2026-06-01T10:00:00.000Z"),
        finishedAt: new Date("2026-06-01T10:05:00.000Z"),
      });

      // Should have called insert (upsert)
      expect(insertMock).toHaveBeenCalledTimes(1);

      // Row should have the expected shape
      expect(row.sessionId).toBe("session-1");
      expect(row.taskToolCallId).toBe("task-tool-call-1");
      expect(row.workerType).toBe("executor");
      expect(row.status).toBe("completed");
      expect(row.toolCallCount).toBe(5);
    });

    test("redacts secrets from summary before persisting", async () => {
      const { redactHarnessValue } = await import("@/lib/harness/redaction");

      await recordManagedRuntimeWorkerRun({
        sessionId: "session-1",
        chatId: null,
        userId: "user-1",
        workflowRunId: null,
        taskToolCallId: "task-2",
        workerType: "executor",
        status: "running",
        sandboxName: null,
        profileId: null,
        profileVersion: null,
        profileDisplayName: null,
        profileRunId: null,
        toolCallCount: 0,
        summary:
          "Install npm package with OPENAI_API_KEY=sk-12345678901234567890",
        startedAt: null,
        finishedAt: null,
      });

      // redactHarnessValue should have been called with the summary string
      expect(redactHarnessValue).toHaveBeenCalledWith(
        "Install npm package with OPENAI_API_KEY=sk-12345678901234567890",
        "summary",
      );
    });
  });

  describe("listManagedRuntimeWorkerRunsForSession", () => {
    test("returns rows for a given session ordered by createdAt", async () => {
      const rows = await listManagedRuntimeWorkerRunsForSession("session-1");

      expect(findManyMock).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe("session-1");
    });
  });

  describe("toManagedRuntimeWorkerSnapshot", () => {
    test("maps a durable row to a snapshot with source durable", () => {
      const row = {
        id: "wrun_abc",
        sessionId: "session-1",
        chatId: "chat-1",
        userId: "user-1",
        workflowRunId: "wf-1",
        taskToolCallId: "task-tool-call-1",
        workerType: "executor",
        status: "completed" as const,
        sandboxName: "sbx_1",
        profileId: "web-bun-agent-browser",
        profileVersion: "2026-05-23.2",
        profileDisplayName: "Web app with Bun",
        profileRunId: "mprun_1",
        toolCallCount: 5,
        summary: "Implement a feature",
        startedAt: new Date("2026-06-01T10:00:00.000Z"),
        finishedAt: new Date("2026-06-01T10:05:00.000Z"),
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        updatedAt: new Date("2026-06-01T10:05:00.000Z"),
      };

      const snapshot = toManagedRuntimeWorkerSnapshot(row);

      // Source must be "durable" not "message"
      expect(snapshot.source).toBe("durable");
      expect(snapshot.id).toBe("task-tool-call-1");
      expect(snapshot.taskToolCallId).toBe("task-tool-call-1");
      expect(snapshot.workerType).toBe("executor");
      expect(snapshot.status).toBe("completed");

      // Timestamps must be ISO strings, not Date objects
      expect(snapshot.updatedAt).toBe("2026-06-01T10:05:00.000Z");
    });

    test("handles null timestamps gracefully", () => {
      const row = {
        id: "wrun_abc",
        sessionId: "session-1",
        chatId: null,
        userId: "user-1",
        workflowRunId: null,
        taskToolCallId: "task-2",
        workerType: "worker",
        status: "pending" as const,
        sandboxName: null,
        profileId: null,
        profileVersion: null,
        profileDisplayName: null,
        profileRunId: null,
        toolCallCount: 0,
        summary: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        updatedAt: new Date("2026-06-01T10:00:00.000Z"),
      };

      const snapshot = toManagedRuntimeWorkerSnapshot(row);

      expect(snapshot.source).toBe("durable");
      expect(snapshot.updatedAt).toBe("2026-06-01T10:00:00.000Z");
      // currentToolName and currentToolSummary not in durable rows — should be null
      expect(snapshot.currentToolName).toBeNull();
      expect(snapshot.currentToolSummary).toBeNull();
    });
  });
});
