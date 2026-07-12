import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let selectedRows: unknown[] = [];

const limitMock = mock(async () => selectedRows);
const whereMock = mock(() => ({ limit: limitMock }));
const leftJoinMock = mock(() => ({ leftJoin: leftJoinMock, where: whereMock }));
const fromMock = mock(() => ({ leftJoin: leftJoinMock }));
const selectMock = mock(() => ({ from: fromMock }));

const workflowRunStepsFindMany = mock(async () => []);
const workflowInputSnapshotsFindMany = mock(async () => []);

mock.module("@/lib/db/client", () => ({
  db: {
    select: selectMock,
    query: {
      workflowRunSteps: { findMany: workflowRunStepsFindMany },
      workflowInputSnapshots: { findMany: workflowInputSnapshotsFindMany },
    },
  },
}));

const getRepoDashboardData = mock(async () => {
  throw new Error("Repository evidence should not load without a repository");
});

mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData,
}));

const storePromise = import("./diagnosis-store");

describe("account diagnosis store", () => {
  beforeEach(() => {
    selectedRows = [];
    selectMock.mockClear();
    fromMock.mockClear();
    leftJoinMock.mockClear();
    whereMock.mockClear();
    limitMock.mockClear();
    workflowRunStepsFindMany.mockClear();
    workflowInputSnapshotsFindMany.mockClear();
    getRepoDashboardData.mockClear();
  });

  test("preserves canonical Run metadata on chat workflow diagnoses", async () => {
    const startedAt = new Date("2026-07-11T12:00:00.000Z");
    const finishedAt = new Date("2026-07-11T12:01:00.000Z");
    selectedRows = [
      {
        workflowRun: {
          id: "workflow-1",
          chatId: "chat-1",
          sessionId: "session-1",
          userId: "user-1",
          modelId: "provider/model",
          inferenceRoute: "gateway",
          inferenceProfileId: null,
          requestId: "request-1",
          runtimeMode: "classic",
          sandboxName: "sandbox-1",
          managedRuntimeProfileId: null,
          managedRuntimeProfileVersion: null,
          managedRuntimeProfileRunId: null,
          errorMessage: null,
          status: "completed",
          startedAt,
          finishedAt,
          totalDurationMs: 60_000,
          createdAt: startedAt,
        },
        session: null,
        chat: { id: "chat-1", title: "Implement the feature" },
      },
    ];

    const { buildDbBackedAccountDiagnosis } = await storePromise;
    const diagnosis = await buildDbBackedAccountDiagnosis({
      userId: "user-1",
      source: "chat_workflow",
      id: "workflow-1",
      now: finishedAt,
    });

    expect(diagnosis?.target).toMatchObject({
      id: "workflow-1",
      source: "chat_workflow",
      metadata: {
        normalizedRunId: "chat_workflow:workflow-1",
        nativeStatus: "completed",
        nativeSource: null,
        runState: "finished",
        runOutcome: "succeeded",
        runHealth: "ok",
        detailUrl: "/sessions/session-1/chats/chat-1",
        chatId: "chat-1",
        sessionId: "session-1",
        runtimeMode: "classic",
        prNumber: null,
        prStatus: null,
      },
    });
    expect(getRepoDashboardData).not.toHaveBeenCalled();
  });
});
