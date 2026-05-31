import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let requireResult:
  | {
      ok: true;
      run: {
        id: string;
        userId: string;
        sessionId: string | null;
        chatId: string | null;
        workflowRunId: string | null;
        requestId: string | null;
        status: string;
        finishedAt: Date | null;
      };
    }
  | { ok: false; response: Response };
let cancelCalls = 0;
let casCalls: unknown[] = [];
let updateCalls: unknown[] = [];
let eventCalls: unknown[] = [];

const requireAgentApiRun = mock(async () => requireResult);
const compareAndSetChatActiveStreamId = mock(async (...args: unknown[]) => {
  casCalls.push(args);
  return false;
});
const recordApiRunEvent = mock(async (input: unknown) => {
  eventCalls.push(input);
});

mock.module("@/app/api/v1/agent-runs/[runId]/route", () => ({
  requireAgentApiRun,
}));
mock.module("workflow/api", () => ({
  getRun: () => ({
    cancel: () => {
      cancelCalls += 1;
    },
  }),
}));
mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId,
}));
mock.module("@/lib/db/client", () => ({
  db: {
    update: (table: unknown) => {
      updateCalls.push({ table });
      return {
        set: (patch: unknown) => {
          updateCalls.push({ patch });
          return {
            where: (where: unknown) => {
              updateCalls.push({ where });
              return {
                returning: async () => [
                  {
                    ...(requireResult.ok ? requireResult.run : {}),
                    status: "cancelled",
                    finishedAt: new Date("2026-05-30T12:00:00.000Z"),
                    updatedAt: new Date("2026-05-30T12:00:00.000Z"),
                  },
                ],
              };
            },
          };
        },
      };
    },
  },
}));
mock.module("@/lib/agent-api-runs/snapshots", () => ({
  getAgentRunSnapshot: async (run: { id: string; status?: string }) => ({
    id: run.id,
    status: run.status ?? "cancelled",
  }),
}));
mock.module("@/lib/agent-api-runs/runs", () => ({
  recordApiRunEvent,
}));

const routeModulePromise = import("./route");

describe("POST /api/v1/agent-runs/[runId]/cancel", () => {
  beforeEach(() => {
    requireResult = {
      ok: true,
      run: {
        id: "arun_test",
        userId: "user-1",
        sessionId: "session_test",
        chatId: "chat_test",
        workflowRunId: "workflow_test",
        requestId: "req-test",
        status: "running",
        finishedAt: null,
      },
    };
    cancelCalls = 0;
    casCalls = [];
    updateCalls = [];
    eventCalls = [];
    requireAgentApiRun.mockClear();
    compareAndSetChatActiveStreamId.mockClear();
    recordApiRunEvent.mockClear();
  });

  test("requires cancel scope through the shared run guard", async () => {
    const { POST } = await routeModulePromise;

    await POST(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "arun_test" }),
    });

    expect(requireAgentApiRun).toHaveBeenCalledWith(
      expect.any(Request),
      expect.any(Object),
      ["agent_runs:cancel"],
    );
  });

  test("cancels workflow and clears only the matching active stream id", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "arun_test" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agentRun).toEqual({
      id: "arun_test",
      status: "cancelled",
    });
    expect(cancelCalls).toBe(1);
    expect(casCalls).toEqual([["chat_test", "workflow_test", null]]);
    expect(eventCalls).toEqual([
      expect.objectContaining({
        eventName: "agent_api.run.cancelled",
        workflowRunId: "workflow_test",
      }),
    ]);
  });

  test("returns conflict when the run has no workflow to cancel", async () => {
    requireResult = {
      ok: true,
      run: {
        id: "arun_test",
        userId: "user-1",
        sessionId: "session_test",
        chatId: "chat_test",
        workflowRunId: null,
        requestId: "req-test",
        status: "running",
        finishedAt: null,
      },
    };
    const { POST } = await routeModulePromise;

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "arun_test" }),
    });

    expect(response.status).toBe(409);
    expect(cancelCalls).toBe(0);
    expect(compareAndSetChatActiveStreamId).not.toHaveBeenCalled();
  });
});
