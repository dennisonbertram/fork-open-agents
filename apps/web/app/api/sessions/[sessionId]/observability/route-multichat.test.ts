/**
 * RED tests for multi-chat attribution regression (FIX 1 / TASK-ISSUE-74).
 *
 * Bug: listManagedRuntimeWorkerRunsForSession is called with sessionId only.
 * If chat-A has durable rows, a request for chat-B returns chat-A's rows
 * (wrong) instead of falling back to chat-B's message-derived workers.
 *
 * Fix required:
 *   - listManagedRuntimeWorkerRunsForSession accepts { sessionId, chatId }
 *   - route calls it with the requested chatId
 *   - durable-first gate is per-chat, not per-session
 */

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

// ---- Message-derived workers (fallback) ----
// chat-B's message-derived workers
const chatBMessageWorker = {
  id: "task-chat-b-msg",
  source: "message" as const,
  taskToolCallId: "task-chat-b-msg",
  workerType: "executor",
  status: "completed" as const,
  sandboxName: "sbx_b",
  profileId: "web-bun-agent-browser",
  profileVersion: "2026-05-23.2",
  profileDisplayName: "Web app with Bun",
  profileRunId: "mprun_b",
  currentToolName: null,
  currentToolSummary: null,
  toolCallCount: 2,
  summary: "chat-B task",
  updatedAt: "2026-06-01T11:00:00.000Z",
};

const extractManagedRuntimeWorkersFromMessagesMock = mock(
  () => [chatBMessageWorker],
);

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

// ---- Durable worker run helpers ----
type DurableWorkerRow = {
  id: string;
  sessionId: string;
  chatId: string | null;
  userId: string;
  workflowRunId: string | null;
  taskToolCallId: string;
  workerType: string;
  status: string;
  sandboxName: string | null;
  profileId: string | null;
  profileVersion: string | null;
  profileDisplayName: string | null;
  profileRunId: string | null;
  toolCallCount: number;
  summary: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Chat-A has a durable row; chat-B has none
const chatADurableRow: DurableWorkerRow = {
  id: "wrun_chat_a",
  sessionId: "session-1",
  chatId: "chat-A",
  userId: "user-1",
  workflowRunId: null,
  taskToolCallId: "task-chat-a-durable",
  workerType: "executor",
  status: "completed",
  sandboxName: null,
  profileId: null,
  profileVersion: null,
  profileDisplayName: null,
  profileRunId: null,
  toolCallCount: 1,
  summary: null,
  startedAt: new Date("2026-06-01T10:00:00.000Z"),
  finishedAt: new Date("2026-06-01T10:05:00.000Z"),
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:05:00.000Z"),
};

const chatBDurableRow: DurableWorkerRow = {
  id: "wrun_chat_b",
  sessionId: "session-1",
  chatId: "chat-B",
  userId: "user-1",
  workflowRunId: null,
  taskToolCallId: "task-chat-b-durable",
  workerType: "executor",
  status: "completed",
  sandboxName: null,
  profileId: null,
  profileVersion: null,
  profileDisplayName: null,
  profileRunId: null,
  toolCallCount: 2,
  summary: null,
  startedAt: new Date("2026-06-01T11:00:00.000Z"),
  finishedAt: new Date("2026-06-01T11:05:00.000Z"),
  createdAt: new Date("2026-06-01T11:00:00.000Z"),
  updatedAt: new Date("2026-06-01T11:05:00.000Z"),
};

// This mock simulates the FIXED behaviour: returns only rows matching chatId
const listManagedRuntimeWorkerRunsForSessionMock = mock(
  (params: { sessionId: string; chatId?: string | null }): Promise<DurableWorkerRow[]> => {
    // Return only rows matching the requested chatId
    if (params.chatId === "chat-A") {
      return Promise.resolve([chatADurableRow]);
    }
    if (params.chatId === "chat-B") {
      return Promise.resolve([chatBDurableRow]);
    }
    // No chatId filter → return all (session-scoped)
    return Promise.resolve([chatADurableRow, chatBDurableRow]);
  },
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

describe("/api/sessions/[sessionId]/observability GET — multi-chat attribution", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionMock.mockClear();
    extractManagedRuntimeWorkersFromMessagesMock.mockClear();
    listManagedRuntimeWorkerRunsForSessionMock.mockClear();
    toManagedRuntimeWorkerSnapshotMock.mockClear();
  });

  test("BT-MC-001: chat-B request with only chat-A durable rows falls back to chat-B's message-derived workers", async () => {
    // Simulate the pre-fix bug: return ALL session rows (chat-A + chat-B) regardless of chatId
    // After the fix, the mock is called with { sessionId, chatId: "chat-B" } and returns []
    // so it falls back to message-derived workers for chat-B.
    // This test verifies the route passes chatId to the query function and uses per-chat result.
    listManagedRuntimeWorkerRunsForSessionMock.mockImplementation(
      (params: { sessionId: string; chatId?: string | null }): Promise<DurableWorkerRow[]> => {
        // Correct behaviour: filter by chatId. chat-B has NO durable rows.
        if (params.chatId === "chat-B") {
          return Promise.resolve([]);
        }
        // If called with just sessionId (old bug), would return chat-A rows
        return Promise.resolve([chatADurableRow]);
      },
    );

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/observability?chatId=chat-B",
      ),
      createRouteContext("session-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workers: Array<{ source: string; id: string }>;
    };

    // CRITICAL: chat-B has no durable rows, so it must fall back to message-derived
    // (not return chat-A's durable workers)
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].source).toBe("message");
    expect(body.workers[0].id).toBe("task-chat-b-msg");

    // The query function MUST have been called with the chatId parameter
    expect(listManagedRuntimeWorkerRunsForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-B" }),
    );
    // message-derived extraction was called as fallback
    expect(extractManagedRuntimeWorkersFromMessagesMock).toHaveBeenCalledTimes(1);
  });

  test("BT-MC-002: chat-B request with chat-B durable rows returns those durable workers (positive case)", async () => {
    // chat-B has its own durable rows → route should return those (source "durable")
    listManagedRuntimeWorkerRunsForSessionMock.mockImplementation(
      (params: { sessionId: string; chatId?: string | null }): Promise<DurableWorkerRow[]> => {
        if (params.chatId === "chat-B") {
          return Promise.resolve([chatBDurableRow]);
        }
        return Promise.resolve([]);
      },
    );

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/observability?chatId=chat-B",
      ),
      createRouteContext("session-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workers: Array<{ source: string; id: string }>;
    };

    // chat-B has durable rows → must use them
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].source).toBe("durable");
    expect(body.workers[0].id).toBe("task-chat-b-durable");

    // message-derived fallback must NOT have been called
    expect(extractManagedRuntimeWorkersFromMessagesMock).not.toHaveBeenCalled();
  });

  test("BT-MC-003: listManagedRuntimeWorkerRunsForSession is called with an object containing sessionId and chatId", async () => {
    // Verify the route passes the chatId in the query params, not just sessionId.
    // This test will FAIL with the old code that passes a bare string sessionId.
    listManagedRuntimeWorkerRunsForSessionMock.mockImplementation(
      (): Promise<DurableWorkerRow[]> => Promise.resolve([]),
    );

    const { GET } = await routeModulePromise;
    await GET(
      new Request(
        "http://localhost/api/sessions/session-1/observability?chatId=chat-Z",
      ),
      createRouteContext("session-1"),
    );

    // Must be called with object form { sessionId, chatId } not bare string
    expect(listManagedRuntimeWorkerRunsForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        chatId: "chat-Z",
      }),
    );
  });
});
