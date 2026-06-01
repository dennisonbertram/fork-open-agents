import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---- Auth / session context mocks ----
const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));

const requireOwnedSessionMock = mock(async () => ({
  ok: true as const,
  sessionRecord: {
    id: "session-1",
    userId: "user-1",
    runtimeMode: "managed_runtime" as const,
  },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSession: requireOwnedSessionMock,
}));

// ---- DB client mock ----
mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      workflowRuns: {
        findMany: mock(() => Promise.resolve([])),
      },
    },
    select: mock(() => ({
      from: mock(() => ({
        innerJoin: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => ({
              limit: mock(() => Promise.resolve([])),
            })),
          })),
        })),
      })),
    })),
  },
}));

// ---- Observability / persistence module mocks ----

// Message-derived workers (fallback source)
const extractManagedRuntimeWorkersFromMessagesMock = mock(() => [
  {
    id: "task-1",
    source: "message" as const,
    taskToolCallId: "task-1",
    workerType: "executor",
    status: "completed" as const,
    sandboxName: "sbx_1",
    profileId: "web-bun-agent-browser",
    profileVersion: "2026-05-23.2",
    profileDisplayName: "Web app with Bun",
    profileRunId: "mprun_1",
    currentToolName: null,
    currentToolSummary: null,
    toolCallCount: 3,
    summary: "Implement feature",
    updatedAt: "2026-06-01T10:00:00.000Z",
  },
]);

const summarizeManagedRuntimeDirectToolUseFromMessagesMock = mock(() => ({
  observed: false,
  count: 0,
  toolTypes: [],
  toolLabels: [],
  warning: null,
}));

mock.module("@/lib/observability/managed-runtime-workers", () => ({
  extractManagedRuntimeWorkersFromMessages:
    extractManagedRuntimeWorkersFromMessagesMock,
  summarizeManagedRuntimeDirectToolUseFromMessages:
    summarizeManagedRuntimeDirectToolUseFromMessagesMock,
}));

// Durable worker run helpers
const listManagedRuntimeWorkerRunsForSessionMock = mock(() =>
  Promise.resolve([]),
);
const toManagedRuntimeWorkerSnapshotMock = mock(
  (row: { taskToolCallId: string; workerType: string; status: string }) => ({
    id: row.taskToolCallId,
    source: "durable" as const,
    taskToolCallId: row.taskToolCallId,
    workerType: row.workerType,
    status: row.status,
    sandboxName: null,
    profileId: null,
    profileVersion: null,
    profileDisplayName: null,
    profileRunId: null,
    currentToolName: null,
    currentToolSummary: null,
    toolCallCount: 0,
    summary: null,
    updatedAt: "2026-06-01T10:00:00.000Z",
  }),
);

mock.module("@/lib/observability/managed-runtime-worker-runs", () => ({
  listManagedRuntimeWorkerRunsForSession:
    listManagedRuntimeWorkerRunsForSessionMock,
  toManagedRuntimeWorkerSnapshot: toManagedRuntimeWorkerSnapshotMock,
}));

// Other dependencies
mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  listManagedRuntimeProfileRuns: mock(() => Promise.resolve([])),
  toManagedRuntimeProfileRunSnapshot: mock((r: unknown) => r),
}));

mock.module("@/lib/observability/events", () => ({
  listSessionEvents: mock(() => Promise.resolve([])),
  toSessionEventSnapshot: mock((e: unknown) => e),
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: mock(() => Promise.resolve([])),
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: mock(() => Promise.resolve([])),
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/observability GET", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionMock.mockClear();
    extractManagedRuntimeWorkersFromMessagesMock.mockClear();
    listManagedRuntimeWorkerRunsForSessionMock.mockClear();
    toManagedRuntimeWorkerSnapshotMock.mockClear();
  });

  test("returns durable workers (source durable) when durable rows exist", async () => {
    const durableRow = {
      id: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      workflowRunId: "wf-1",
      taskToolCallId: "task-durable-1",
      workerType: "executor",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 3,
      summary: null,
      startedAt: new Date("2026-06-01T10:00:00.000Z"),
      finishedAt: new Date("2026-06-01T10:05:00.000Z"),
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      updatedAt: new Date("2026-06-01T10:05:00.000Z"),
    };

    listManagedRuntimeWorkerRunsForSessionMock.mockImplementation(() =>
      Promise.resolve([durableRow]),
    );

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/observability?chatId=chat-1",
      ),
      createRouteContext("session-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workers: Array<{ source: string; id: string }>;
    };

    // When durable rows exist, use them (source "durable")
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].source).toBe("durable");
    expect(body.workers[0].id).toBe("task-durable-1");

    // Message-derived fallback should NOT have been called
    expect(extractManagedRuntimeWorkersFromMessagesMock).not.toHaveBeenCalled();
  });

  test("falls back to message-derived workers when no durable rows exist", async () => {
    // Default mock returns empty array (no durable rows)
    listManagedRuntimeWorkerRunsForSessionMock.mockImplementation(() =>
      Promise.resolve([]),
    );

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/observability?chatId=chat-1",
      ),
      createRouteContext("session-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workers: Array<{ source: string }>;
    };

    // Falls back to message-derived workers
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].source).toBe("message");

    // Message-derived extract should have been called as fallback
    expect(extractManagedRuntimeWorkersFromMessagesMock).toHaveBeenCalledTimes(
      1,
    );
  });
});
