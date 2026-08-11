import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Contract this test file establishes for the not-yet-written
// `sessions-write.ts` (see AGENTS.md task for module 2):
//
//   - `createSession` / `createChat` (existing db/sessions.ts helpers) do the
//     session+chat provisioning for start_session.
//   - `getSessionMetadataById` (the SAME lightweight ownership projection the
//     read tools use — see sessions-read.ts) is the ownership check for
//     send_message and stop_run.
//   - `getChatById` validates an explicit chatId belongs to the session.
//   - `getChatsBySessionId` (already ordered most-recent-activity-first, see
//     lib/db/sessions.ts) is the fallback when chatId is omitted.
const createSession = mock(
  async (_data: unknown) => ({ id: "session-1", userId: "user-1" }) as unknown,
);
const createChat = mock(
  async (_data: unknown) =>
    ({ id: "chat-1", sessionId: "session-1" }) as unknown,
);
const getSessionMetadataById = mock(
  async (_id: string) => undefined as unknown,
);
const getChatById = mock(async (_id: string) => undefined as unknown);
const getChatsBySessionId = mock(async (_sessionId: string) => [] as unknown[]);

// The rest of these are not exercised by sessions-write.ts itself, but
// registry.ts also loads sessions-read.ts (and sessions-write.ts loads
// messages-from-db.ts) transitively from this same module path — Bun's
// mock.module replaces the WHOLE module, so every symbol any of them import
// from "@/lib/db/sessions" must be exported here too, or the import fails at
// load time (see AGENTS.md's "BUN MOCK GOTCHA").
const countChatMessages = mock(async (_chatId: string) => 0);
const countSessionsByUserId = mock(
  async (_userId: string, _opts: unknown) => 0,
);
const getChatSummariesBySessionId = mock(
  async (_sessionId: string, _userId: string) => [] as unknown[],
);
const getRecentChatMessages = mock(
  async (_chatId: string, _limit?: number) => [] as unknown[],
);
const getSessionDiffById = mock(
  async (_sessionId: string) => undefined as unknown,
);
const getSessionsWithUnreadByUserId = mock(
  async (_userId: string, _opts: unknown) => [] as unknown[],
);

mock.module("@/lib/db/sessions", () => ({
  createSession,
  createChat,
  getSessionMetadataById,
  getChatById,
  getChatsBySessionId,
  countChatMessages,
  countSessionsByUserId,
  getChatSummariesBySessionId,
  getRecentChatMessages,
  getSessionDiffById,
  getSessionsWithUnreadByUserId,
}));

// Rate limiting for start_session must use the SAME key/ceiling shape as the
// browser session-create path (apps/web/app/api/sessions/route.ts): key
// "sessions-create:<userId>", limit 10, windowMs 60_000. `rateLimitKey` here
// is a faithful reimplementation of the real one (lib/rate-limit.ts) so
// assertions on the composed key stay meaningful.
const checkRateLimit = mock(async (_options: unknown) => null as unknown);
const rateLimitKey = mock((parts: (number | string | null | undefined)[]) =>
  parts.map((part) => String(part ?? "unknown")).join(":"),
);

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit,
  rateLimitKey,
}));

// Contract: sessions-write.ts imports the durable-run handshake
// (startChatRun, module 1) plus a sibling stopChatRun helper from the same
// module, both operating on a chatId.
const startChatRun = mock(
  async (_input: unknown) => ({ status: "started", runId: "run-1" }) as unknown,
);
const stopChatRun = mock(
  async (_input: unknown) =>
    ({ stopped: false, workflowRunId: null }) as unknown,
);

mock.module("@/lib/chat/start-run", () => ({
  startChatRun,
  stopChatRun,
}));

const toolsModulePromise = import("./sessions-write");
const registryModulePromise = import("../registry");
const contextModulePromise = import("../context");

// Minimal literal matching McpToolContext's shape; avoids importing `any`.
function makeCtx(overrides: {
  userId?: string;
  scopes?: string[];
  requestId?: string;
}) {
  return {
    userId: overrides.userId ?? "user-1",
    scopes: overrides.scopes ?? ["sessions:write"],
    requestId: overrides.requestId ?? "req-1",
  };
}

function buildSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    repoOwner: "acme",
    repoName: "widgets",
    branch: "main",
    ...overrides,
  };
}

function seedSession(row: unknown): void {
  getSessionMetadataById.mockImplementation(async () => row);
}

const TOOL_NAMES = ["start_session", "send_message", "stop_run"];

function expectNoWriteIo(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(createChat).not.toHaveBeenCalled();
  expect(getSessionMetadataById).not.toHaveBeenCalled();
  expect(getChatById).not.toHaveBeenCalled();
  expect(getChatsBySessionId).not.toHaveBeenCalled();
  expect(startChatRun).not.toHaveBeenCalled();
  expect(stopChatRun).not.toHaveBeenCalled();
  expect(checkRateLimit).not.toHaveBeenCalled();
}

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://mcp.test";
  createSession.mockClear();
  createSession.mockImplementation(
    async () => ({ id: "session-1", userId: "user-1" }) as unknown,
  );
  createChat.mockClear();
  createChat.mockImplementation(
    async () => ({ id: "chat-1", sessionId: "session-1" }) as unknown,
  );
  getSessionMetadataById.mockClear();
  seedSession(undefined);
  getChatById.mockClear();
  getChatById.mockImplementation(async () => undefined);
  getChatsBySessionId.mockClear();
  getChatsBySessionId.mockImplementation(async () => []);
  checkRateLimit.mockClear();
  checkRateLimit.mockImplementation(async () => null);
  rateLimitKey.mockClear();
  startChatRun.mockClear();
  startChatRun.mockImplementation(
    async () => ({ status: "started", runId: "run-1" }) as unknown,
  );
  stopChatRun.mockClear();
  stopChatRun.mockImplementation(
    async () => ({ stopped: false, workflowRunId: null }) as unknown,
  );
});

afterEach(() => {
  delete process.env.BETTER_AUTH_URL;
});

describe("scope enforcement via runMcpTool", () => {
  for (const name of TOOL_NAMES) {
    test(`${name} refuses with forbidden_scope and does no I/O when sessions:write is missing`, async () => {
      const { runMcpTool } = await registryModulePromise;
      const { McpToolError } = await contextModulePromise;
      const ctx = makeCtx({ scopes: [] });

      const promise = runMcpTool(name, ctx, {});

      await expect(promise).rejects.toBeInstanceOf(McpToolError);
      await expect(promise).rejects.toMatchObject({
        errorKind: "forbidden_scope",
      });
      expectNoWriteIo();
    });

    test(`${name} refuses with forbidden_scope when the token only holds sessions:read`, async () => {
      const { runMcpTool } = await registryModulePromise;
      const { McpToolError } = await contextModulePromise;
      const ctx = makeCtx({ scopes: ["sessions:read"] });

      const promise = runMcpTool(name, ctx, {});

      await expect(promise).rejects.toBeInstanceOf(McpToolError);
      await expect(promise).rejects.toMatchObject({
        errorKind: "forbidden_scope",
      });
      expectNoWriteIo();
    });
  }
});

describe("startSession", () => {
  test("creates the session + chat, starts the workflow, and returns without consuming a stream", async () => {
    const { startSession } = await toolsModulePromise;
    createSession.mockImplementation(async (data) => {
      expect((data as Record<string, unknown>).userId).toBe("user-1");
      return { id: "session-new", userId: "user-1" };
    });
    createChat.mockImplementation(async (data) => {
      expect((data as Record<string, unknown>).sessionId).toBe("session-new");
      return { id: "chat-new", sessionId: "session-new" };
    });
    startChatRun.mockImplementation(async (input) => {
      expect((input as Record<string, unknown>).sessionId).toBe("session-new");
      expect((input as Record<string, unknown>).chatId).toBe("chat-new");
      expect((input as Record<string, unknown>).userId).toBe("user-1");
      return { status: "started", runId: "run-new" };
    });

    const result = await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
    });

    // Exact equality proves the tool returns only the documented fields —
    // in particular no stream/readable, since it never consumes one.
    expect(result).toEqual({
      sessionId: "session-new",
      chatId: "chat-new",
      workflowRunId: "run-new",
      url: "https://mcp.test/sessions/session-new/chats/chat-new",
      sandboxProvisioning: true,
    });
    expect(startChatRun).toHaveBeenCalledTimes(1);
  });

  test("surfaces the rate limit as errorKind rate_limited, using the same key/ceiling as the browser session-create path", async () => {
    const { startSession } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    checkRateLimit.mockImplementation(
      async () => new Response(null, { status: 429 }),
    );

    let caught: unknown;
    try {
      await startSession(makeCtx({ userId: "user-9" }), {
        repoOwner: "acme",
        repoName: "widgets",
        prompt: "build the thing",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "rate_limited",
    );
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "sessions-create:user-9",
      limit: 10,
      windowMs: 60_000,
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(createChat).not.toHaveBeenCalled();
    expect(startChatRun).not.toHaveBeenCalled();
  });
});

describe("sendMessage ownership", () => {
  test("a missing session and a session owned by a different user produce byte-identical not_found errors", async () => {
    const { sendMessage } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    const ctx = makeCtx({ userId: "user-1" });

    seedSession(undefined);
    let missingError: unknown;
    try {
      await sendMessage(ctx, { sessionId: "session-x", prompt: "hi" });
    } catch (error) {
      missingError = error;
    }

    seedSession(buildSessionRow({ id: "session-x", userId: "someone-else" }));
    let foreignError: unknown;
    try {
      await sendMessage(ctx, { sessionId: "session-x", prompt: "hi" });
    } catch (error) {
      foreignError = error;
    }

    expect(missingError).toBeInstanceOf(McpToolError);
    expect(foreignError).toBeInstanceOf(McpToolError);
    const missing = missingError as InstanceType<typeof McpToolError>;
    const foreign = foreignError as InstanceType<typeof McpToolError>;

    expect(missing.errorKind).toBe("not_found");
    expect(foreign.errorKind).toBe("not_found");
    expect(missing.message).toBe(foreign.message);
    expect(missing.message).toBe("Session session-x was not found.");
    expect(missing.details).toBeUndefined();
    expect(foreign.details).toBeUndefined();
    expect(startChatRun).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  test("throws conflict with the running workflowRunId when a run is already live", async () => {
    const { sendMessage } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    seedSession(buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-1", sessionId: "session-1" },
    ]);
    startChatRun.mockImplementation(async () => ({
      status: "resumed",
      runId: "run-live",
    }));

    let caught: unknown;
    try {
      await sendMessage(makeCtx({}), {
        sessionId: "session-1",
        prompt: "keep going",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    const error = caught as InstanceType<typeof McpToolError>;
    expect(error.errorKind).toBe("conflict");
    expect(error.details).toMatchObject({ workflowRunId: "run-live" });
  });

  test("falls back to the session's most recently active chat when chatId is omitted, and starts normally on a stale slot", async () => {
    const { sendMessage } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatsBySessionId.mockImplementation(async (sessionId) => {
      expect(sessionId).toBe("session-1");
      return [
        { id: "chat-most-recent", sessionId: "session-1" },
        { id: "chat-older", sessionId: "session-1" },
      ];
    });
    startChatRun.mockImplementation(async () => ({
      status: "started",
      runId: "run-1",
    }));

    const result = await sendMessage(makeCtx({}), {
      sessionId: "session-1",
      prompt: "hi",
    });

    expect(result.chatId).toBe("chat-most-recent");
    expect(result.workflowRunId).toBe("run-1");
    // The fallback resolves the chat itself; an explicit-chatId lookup never runs.
    expect(getChatById).not.toHaveBeenCalled();
  });
});

describe("stopRun", () => {
  test("cancels a live run and reports stopped:true with the workflowRunId", async () => {
    const { stopRun } = await toolsModulePromise;
    seedSession(buildSessionRow());
    stopChatRun.mockImplementation(async () => ({
      stopped: true,
      workflowRunId: "run-1",
    }));

    const result = await stopRun(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      chatId: "chat-1",
      stopped: true,
      workflowRunId: "run-1",
    });
  });

  test("is idempotent: no live run resolves successfully with stopped:false and workflowRunId:null, not an error", async () => {
    const { stopRun } = await toolsModulePromise;
    seedSession(buildSessionRow());
    stopChatRun.mockImplementation(async () => ({
      stopped: false,
      workflowRunId: null,
    }));

    const result = await stopRun(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      chatId: "chat-1",
      stopped: false,
      workflowRunId: null,
    });
  });

  test("throws not_found for a session owned by a different user", async () => {
    const { stopRun } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    seedSession(buildSessionRow({ userId: "someone-else" }));

    let caught: unknown;
    try {
      await stopRun(makeCtx({ userId: "user-1" }), {
        sessionId: "session-1",
        chatId: "chat-1",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "not_found",
    );
    expect(stopChatRun).not.toHaveBeenCalled();
  });
});
