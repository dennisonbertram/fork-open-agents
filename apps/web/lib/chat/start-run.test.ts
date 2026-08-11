import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

mock.module("server-only", () => ({}));

// --- workflow/api (start-run.ts imports `getRun` lazily via
// `await import("workflow/api")`, mirroring route.ts; `start` is a normal
// static import) ---
const startWorkflow = mock(
  async (_workflow: unknown, _args: unknown[]) =>
    ({ runId: "run-new" }) as { runId: string },
);

const runStatusByRunId = new Map<string, string>();
const cancelSpy = mock(async () => {});

const getRun = mock((runId: string) => {
  if (!runStatusByRunId.has(runId)) {
    throw new Error(`workflow run not found: ${runId}`);
  }
  return {
    status: Promise.resolve(runStatusByRunId.get(runId)),
    cancel: cancelSpy,
  };
});

mock.module("workflow/api", () => ({
  start: startWorkflow,
  getRun,
}));

// --- @/app/workflows/chat ---
const runAgentWorkflow = mock(() => {});
mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow,
}));

// --- @/lib/db/sessions ---
const getChatById = mock(async () => undefined as unknown);
const createChatMessageIfNotExists = mock(
  async (data: { id: string }) => ({ id: data.id }) as unknown,
);
const touchChat = mock(async () => {});
const isFirstChatMessage = mock(async () => false);
const updateChat = mock(async () => {});
const compareAndSetChatActiveStreamId = mock(async () => true);
const claimChatActiveStreamId = mock(async () => true);

mock.module("@/lib/db/sessions", () => ({
  getChatById,
  createChatMessageIfNotExists,
  touchChat,
  isFirstChatMessage,
  updateChat,
  compareAndSetChatActiveStreamId,
  claimChatActiveStreamId,
}));

const moduleUnderTestPromise = import("./start-run");

function userMessage(
  text: string,
  id = "msg-1",
): WebAgentUIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as WebAgentUIMessage;
}

type StartChatRunInput = {
  chatId: string;
  sessionId: string;
  userId: string;
  messages: WebAgentUIMessage[];
  requestUrl: string;
  requestId?: string;
  authSession: unknown;
  maxSteps?: number;
};

function baseInput(overrides: Partial<StartChatRunInput> = {}): StartChatRunInput {
  return {
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    messages: [userMessage("hello there")],
    requestUrl: "https://mcp.test/api/chat",
    requestId: "req-1",
    authSession: null,
    ...overrides,
  };
}

beforeEach(() => {
  startWorkflow.mockClear();
  startWorkflow.mockImplementation(async () => ({ runId: "run-new" }));
  runStatusByRunId.clear();
  getRun.mockClear();
  cancelSpy.mockClear();
  runAgentWorkflow.mockClear();
  getChatById.mockClear();
  getChatById.mockImplementation(async () => ({
    id: "chat-1",
    activeStreamId: null,
  }));
  createChatMessageIfNotExists.mockClear();
  createChatMessageIfNotExists.mockImplementation(
    async (data: { id: string }) => ({ id: data.id }),
  );
  touchChat.mockClear();
  touchChat.mockImplementation(async () => {});
  isFirstChatMessage.mockClear();
  isFirstChatMessage.mockImplementation(async () => false);
  updateChat.mockClear();
  updateChat.mockImplementation(async () => {});
  compareAndSetChatActiveStreamId.mockClear();
  compareAndSetChatActiveStreamId.mockImplementation(async () => true);
  claimChatActiveStreamId.mockClear();
  claimChatActiveStreamId.mockImplementation(async () => true);
});

describe("startChatRun: existing active stream", () => {
  test("a running run is resumed and no new workflow is started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-live", "running");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-live",
    }));

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "resumed", runId: "run-live" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(claimChatActiveStreamId).not.toHaveBeenCalled();
    expect(createChatMessageIfNotExists).not.toHaveBeenCalled();
  });

  test("a pending run is resumed and no new workflow is started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-live", "pending");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-live",
    }));

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "resumed", runId: "run-live" });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("a dead/unknown run clears the slot via compare-and-set and starts a new run", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    // getRun throws for any runId not seeded into runStatusByRunId — "run-dead"
    // is never seeded, so getRun("run-dead") throws, matching an unknown run.
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-dead",
    }));
    compareAndSetChatActiveStreamId.mockImplementation(
      async (_chatId: string, expected: string | null) =>
        expected === "run-dead",
    );

    const result = await startChatRun(baseInput());

    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "run-dead",
      null,
    );
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "started", runId: "run-new" });
  });

  test("a terminal (non-running) run also clears the slot and starts a new run", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-done", "completed");
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-done",
    }));
    compareAndSetChatActiveStreamId.mockImplementation(
      async (_chatId: string, expected: string | null) =>
        expected === "run-done",
    );

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "started", runId: "run-new" });
  });

  test("compare-and-set losing repeatedly against a still-held slot returns conflict after bounded retries, with no new run started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-stuck", "completed");
    // Every refetch of the chat still reports the same held slot.
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      activeStreamId: "run-stuck",
    }));
    // The CAS never wins — another writer keeps re-claiming it.
    compareAndSetChatActiveStreamId.mockImplementation(async () => false);

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "conflict", runId: "run-stuck" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(claimChatActiveStreamId).not.toHaveBeenCalled();
    // Bounded: exactly 3 attempts, not unbounded polling.
    expect(compareAndSetChatActiveStreamId).toHaveBeenCalledTimes(3);
    expect(getRun).toHaveBeenCalledTimes(3);
  });
});

describe("startChatRun: happy path with no active stream", () => {
  test("persists the user message, starts the workflow, claims the slot, and returns started", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const message = userMessage("hello there", "msg-42");

    const result = await startChatRun(
      baseInput({ messages: [message], maxSteps: 250 }),
    );

    expect(result).toEqual({ status: "started", runId: "run-new" });

    expect(createChatMessageIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "msg-42",
        chatId: "chat-1",
        role: "user",
      }),
    );
    expect(touchChat).toHaveBeenCalledWith("chat-1");

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [workflowFn, args] = startWorkflow.mock.calls[0] as [
      unknown,
      [Record<string, unknown>],
    ];
    expect(workflowFn).toBe(runAgentWorkflow);
    expect(args[0]).toMatchObject({
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      requestUrl: "https://mcp.test/api/chat",
      requestId: "req-1",
      authSession: null,
      maxSteps: 250,
      messages: [message],
    });

    expect(claimChatActiveStreamId).toHaveBeenCalledWith("chat-1", "run-new");
  });

  test("the claim losing the race cancels the just-started run and returns conflict", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    runStatusByRunId.set("run-new", "running");
    claimChatActiveStreamId.mockImplementation(async () => false);

    const result = await startChatRun(baseInput());

    expect(result).toEqual({ status: "conflict", runId: "run-new" });
    expect(getRun).toHaveBeenCalledWith("run-new");
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  test("the first user message sets the chat title, truncated at 80 characters", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    const longText = "x".repeat(120);
    isFirstChatMessage.mockImplementation(async () => true);

    await startChatRun(
      baseInput({ messages: [userMessage(longText, "msg-long")] }),
    );

    expect(updateChat).toHaveBeenCalledTimes(1);
    const [, patch] = updateChat.mock.calls[0] as [string, { title: string }];
    expect(patch.title).toBe(`${"x".repeat(80)}...`);
    expect(patch.title.length).toBe(83);
  });

  test("an already-persisted message id is not double-inserted, and the run still starts", async () => {
    const { startChatRun } = await moduleUnderTestPromise;
    // onConflictDoNothing semantics: nothing created, message already existed.
    createChatMessageIfNotExists.mockImplementation(async () => undefined);

    const result = await startChatRun(baseInput());

    expect(touchChat).not.toHaveBeenCalled();
    expect(isFirstChatMessage).not.toHaveBeenCalled();
    expect(updateChat).not.toHaveBeenCalled();
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "started", runId: "run-new" });
  });
});
