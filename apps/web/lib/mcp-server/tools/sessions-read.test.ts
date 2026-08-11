import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const getSessionsWithUnreadByUserId = mock(
  async (
    _userId: string,
    _options?: { status?: string; limit?: number; offset?: number },
  ) => [] as unknown[],
);
const getSessionById = mock(async () => undefined as unknown);
const getChatById = mock(async () => undefined as unknown);
const getChatsBySessionId = mock(async () => [] as unknown[]);
const getChatSummariesBySessionId = mock(
  async (_sessionId: string, _userId: string) => [] as unknown[],
);
const getChatMessages = mock(async () => [] as unknown[]);

mock.module("@/lib/db/sessions", () => ({
  getSessionsWithUnreadByUserId,
  getSessionById,
  getChatById,
  getChatsBySessionId,
  getChatSummariesBySessionId,
  getChatMessages,
}));

const isSandboxActive = mock(() => false);
mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive,
}));

const toolsModulePromise = import("./sessions-read");
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
    scopes: overrides.scopes ?? ["sessions:read"],
    requestId: overrides.requestId ?? "req-1",
  };
}

function buildSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    title: "Fix the bug",
    status: "running",
    repoOwner: "acme",
    repoName: "widgets",
    branch: "main",
    linesAdded: 3,
    linesRemoved: 1,
    prNumber: null,
    prStatus: null,
    runtimeMode: "classic",
    lifecycleState: "active",
    sandboxState: null,
    cachedDiff: null,
    cachedDiffUpdatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:05:00Z"),
    lastActivityAt: new Date("2026-01-01T00:05:00Z"),
    ...overrides,
  };
}

const TOOL_NAMES = [
  "whoami",
  "list_sessions",
  "get_session",
  "get_messages",
  "get_diff_summary",
];

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://mcp.test";
  getSessionsWithUnreadByUserId.mockClear();
  getSessionsWithUnreadByUserId.mockImplementation(async () => []);
  getSessionById.mockClear();
  getSessionById.mockImplementation(async () => undefined);
  getChatById.mockClear();
  getChatById.mockImplementation(async () => undefined);
  getChatsBySessionId.mockClear();
  getChatsBySessionId.mockImplementation(async () => []);
  getChatSummariesBySessionId.mockClear();
  getChatSummariesBySessionId.mockImplementation(async () => []);
  getChatMessages.mockClear();
  getChatMessages.mockImplementation(async () => []);
  isSandboxActive.mockClear();
});

afterEach(() => {
  delete process.env.BETTER_AUTH_URL;
});

describe("scope enforcement via runMcpTool", () => {
  for (const name of TOOL_NAMES) {
    test(`${name} refuses with forbidden_scope and does no I/O when sessions:read is missing`, async () => {
      const { runMcpTool } = await registryModulePromise;
      const { McpToolError } = await contextModulePromise;
      const ctx = makeCtx({ scopes: [] });

      const promise = runMcpTool(name, ctx, {});

      await expect(promise).rejects.toBeInstanceOf(McpToolError);
      await expect(promise).rejects.toMatchObject({
        errorKind: "forbidden_scope",
      });
      expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
      expect(getSessionById).not.toHaveBeenCalled();
      expect(getChatById).not.toHaveBeenCalled();
      expect(getChatsBySessionId).not.toHaveBeenCalled();
      expect(getChatSummariesBySessionId).not.toHaveBeenCalled();
      expect(getChatMessages).not.toHaveBeenCalled();
    });
  }
});

describe("whoami", () => {
  test("echoes the resolved context with no I/O", async () => {
    const { whoami } = await toolsModulePromise;
    const ctx = makeCtx({
      userId: "user-1",
      scopes: ["sessions:read"],
      requestId: "req-42",
    });

    const result = await whoami(ctx, {});

    expect(result).toEqual({
      userId: "user-1",
      scopes: ["sessions:read"],
      requestId: "req-42",
    });
    expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
  });
});

describe("listSessions", () => {
  test("maps rows to the documented summary shape, scoped to the caller, including a web URL", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async (userId) => {
      expect(userId).toBe("user-1");
      return [
        {
          id: "session-1",
          title: "Fix bug",
          status: "running",
          repoOwner: "acme",
          repoName: "widgets",
          branch: "main",
          linesAdded: null,
          linesRemoved: 5,
          prNumber: 42,
          prStatus: "open",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          hasUnread: true,
          hasStreaming: true,
          latestChatId: "chat-1",
          lastActivityAt: new Date("2026-01-02T00:00:00Z"),
        },
      ];
    });

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.count).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      id: "session-1",
      title: "Fix bug",
      status: "running",
      repo: "acme/widgets",
      branch: "main",
      linesAdded: 0,
      linesRemoved: 5,
      prNumber: 42,
      prStatus: "open",
      hasUnread: true,
      isStreaming: true,
      latestChatId: "chat-1",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      url: "https://mcp.test/sessions/session-1",
    });
  });

  test("returns null repo when either repoOwner or repoName is missing", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-2",
        title: "No repo",
        status: "running",
        repoOwner: null,
        repoName: null,
        branch: null,
        linesAdded: 0,
        linesRemoved: 0,
        prNumber: null,
        prStatus: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        hasUnread: false,
        hasStreaming: false,
        latestChatId: null,
        lastActivityAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.repo).toBeNull();
  });

  test("returns an empty page (not a not_found error) when the caller has no sessions", async () => {
    const { listSessions } = await toolsModulePromise;

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({ sessions: [], count: 0, limit: 20, offset: 0 });
  });
});

describe("getSession ownership", () => {
  test("a missing session and a session owned by a different user produce byte-identical not_found errors", async () => {
    const { getSession } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    const ctx = makeCtx({ userId: "user-1" });

    getSessionById.mockImplementation(async () => undefined);
    let missingError: unknown;
    try {
      await getSession(ctx, { sessionId: "session-x" });
    } catch (error) {
      missingError = error;
    }

    getSessionById.mockImplementation(async () =>
      buildSessionRow({ id: "session-x", userId: "someone-else" }),
    );
    let foreignError: unknown;
    try {
      await getSession(ctx, { sessionId: "session-x" });
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
    // Ownership must be rejected before any chats are fetched.
    expect(getChatSummariesBySessionId).not.toHaveBeenCalled();
  });

  test("returns the full session detail, including chats, for the owning user", async () => {
    const { getSession } = await toolsModulePromise;
    getSessionById.mockImplementation(async () =>
      buildSessionRow({ sandboxState: { type: "vercel", expiresAt: 0 } }),
    );
    getChatSummariesBySessionId.mockImplementation(
      async (sessionId, userId) => {
        expect(sessionId).toBe("session-1");
        expect(userId).toBe("user-1");
        return [
          {
            id: "chat-1",
            title: "Chat one",
            hasUnread: true,
            isStreaming: false,
            lastAssistantMessageAt: new Date("2026-01-01T00:03:00Z"),
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ];
      },
    );

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.id).toBe("session-1");
    expect(result.url).toBe("https://mcp.test/sessions/session-1");
    expect(result.hasUnread).toBe(true);
    expect(result.isStreaming).toBe(false);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0]).toEqual({
      id: "chat-1",
      title: "Chat one",
      isStreaming: false,
      hasUnread: true,
      lastAssistantMessageAt: "2026-01-01T00:03:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      url: "https://mcp.test/sessions/session-1/chats/chat-1",
    });
  });
});

describe("getMessages", () => {
  test("returns the newest `limit` messages, oldest-to-newest, plus the full total", async () => {
    const { getMessages } = await toolsModulePromise;
    getSessionById.mockImplementation(async () => buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    getChatMessages.mockImplementation(async () => [
      {
        id: "m1",
        role: "user",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        parts: [{ type: "text", text: "one" }],
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:01:00Z"),
        parts: [{ type: "text", text: "two" }],
      },
      {
        id: "m3",
        role: "user",
        createdAt: new Date("2026-01-01T00:02:00Z"),
        parts: [{ type: "text", text: "three" }],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 2,
    });

    expect(result.total).toBe(3);
    expect(result.returned).toBe(2);
    expect(result.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(result.sessionId).toBe("session-1");
    expect(result.chatId).toBe("chat-1");
    expect(result.url).toBe("https://mcp.test/sessions/session-1/chats/chat-1");
  });

  test("falls back to the most recently active chat when chatId is omitted", async () => {
    const { getMessages } = await toolsModulePromise;
    getSessionById.mockImplementation(async () => buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-most-recent", sessionId: "session-1" },
      { id: "chat-older", sessionId: "session-1" },
    ]);
    getChatMessages.mockImplementation(async () => []);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      limit: 20,
    });

    expect(result.chatId).toBe("chat-most-recent");
  });

  test("truncates each preview to MESSAGE_PREVIEW_CHARS and flags tool calls", async () => {
    const { getMessages, MESSAGE_PREVIEW_CHARS } = await toolsModulePromise;
    getSessionById.mockImplementation(async () => buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const longText = "x".repeat(MESSAGE_PREVIEW_CHARS + 50);
    getChatMessages.mockImplementation(async () => [
      {
        id: "m1",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        // Nested UIMessage shape: parts live under `.parts`.
        parts: {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: longText }],
        },
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:01:00Z"),
        // Direct-array shape: the column itself is the parts array.
        parts: [
          { type: "text", text: "short reply" },
          { type: "tool-bash", input: {}, output: {} },
        ],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });

    const [first, second] = result.messages;
    expect(first?.preview.length).toBe(MESSAGE_PREVIEW_CHARS);
    expect(first?.preview.endsWith("…")).toBe(true);
    expect(first?.hasToolCalls).toBe(false);
    expect(second?.preview).toBe("short reply");
    expect(second?.hasToolCalls).toBe(true);
  });

  test("throws not_found when the session does not belong to the caller", async () => {
    const { getMessages } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    getSessionById.mockImplementation(async () =>
      buildSessionRow({ userId: "someone-else" }),
    );

    let caught: unknown;
    try {
      await getMessages(makeCtx({ userId: "user-1" }), {
        sessionId: "session-1",
        limit: 20,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "not_found",
    );
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  test("throws not_found when the requested chatId does not belong to the session", async () => {
    const { getMessages } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    getSessionById.mockImplementation(async () => buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-other",
      sessionId: "some-other-session",
    }));

    let caught: unknown;
    try {
      await getMessages(makeCtx({}), {
        sessionId: "session-1",
        chatId: "chat-other",
        limit: 20,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "not_found",
    );
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  test("throws not_found when the session has no chats and chatId was omitted", async () => {
    const { getMessages } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    getSessionById.mockImplementation(async () => buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => []);

    let caught: unknown;
    try {
      await getMessages(makeCtx({}), { sessionId: "session-1", limit: 20 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "not_found",
    );
  });
});

describe("getDiffSummary", () => {
  test("throws not_found for a session owned by a different user", async () => {
    const { getDiffSummary } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    getSessionById.mockImplementation(async () =>
      buildSessionRow({ userId: "someone-else" }),
    );

    let caught: unknown;
    try {
      await getDiffSummary(makeCtx({ userId: "user-1" }), {
        sessionId: "session-1",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpToolError);
    expect((caught as InstanceType<typeof McpToolError>).errorKind).toBe(
      "not_found",
    );
  });

  test("returns hasCachedDiff:false with zeroed totals when there is no cached diff", async () => {
    const { getDiffSummary } = await toolsModulePromise;
    getSessionById.mockImplementation(async () =>
      buildSessionRow({ cachedDiff: null, cachedDiffUpdatedAt: null }),
    );

    const result = await getDiffSummary(makeCtx({}), {
      sessionId: "session-1",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      url: "https://mcp.test/sessions/session-1",
      hasCachedDiff: false,
      computedAt: null,
      baseRef: null,
      totalFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: [],
      truncated: false,
    });
  });

  test("delegates to the cached diff, mapping per-file summaries and capping at MAX_DIFF_FILES", async () => {
    const { getDiffSummary, MAX_DIFF_FILES } = await toolsModulePromise;
    const files = Array.from({ length: MAX_DIFF_FILES + 5 }, (_, i) => ({
      path: `file-${i}.ts`,
      status: "modified" as const,
      additions: 1,
      deletions: 0,
      diff: "should never be returned by the tool",
    }));
    getSessionById.mockImplementation(async () =>
      buildSessionRow({
        cachedDiff: {
          files,
          baseRef: "origin/main",
          summary: {
            totalFiles: files.length,
            totalAdditions: files.length,
            totalDeletions: 0,
          },
        },
        cachedDiffUpdatedAt: new Date("2026-01-03T00:00:00Z"),
      }),
    );

    const result = await getDiffSummary(makeCtx({}), {
      sessionId: "session-1",
    });

    expect(result.hasCachedDiff).toBe(true);
    expect(result.computedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(result.baseRef).toBe("origin/main");
    expect(result.totalFiles).toBe(files.length);
    expect(result.totalAdditions).toBe(files.length);
    expect(result.totalDeletions).toBe(0);
    expect(result.files).toHaveLength(MAX_DIFF_FILES);
    expect(result.truncated).toBe(true);
    expect(result.files[0]).toEqual({
      path: "file-0.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
    });
    // The full diff body is never in the response.
    expect(
      result.files.some((f) => "diff" in (f as Record<string, unknown>)),
    ).toBe(false);
  });
});
