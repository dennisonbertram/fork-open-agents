import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

// Contract this test file establishes for the not-yet-written
// `sessions-write.ts` (see AGENTS.md task for module 2):
//
//   - `createSessionCore` (lib/sessions/create-session.ts) does the
//     session+chat provisioning for start_session. It is the same path the
//     browser route uses, so an MCP-started session inherits the user's
//     default model, inference profile, and repo defaults; hand-rolling the
//     two inserts here silently dropped all of that.
//   - `getUserIdentity` supplies the username createSessionCore needs to
//     generate a branch name, since a token-authenticated caller has no
//     auth session to read it from.
//   - `getSessionMetadataById` (the SAME lightweight ownership projection the
//     read tools use — see sessions-read.ts) is the ownership check for
//     send_message and stop_run.
//   - `getChatById` validates an explicit chatId belongs to the session.
//   - `getChatsBySessionId` (already ordered most-recent-activity-first, see
//     lib/db/sessions.ts) is the fallback when chatId is omitted.
const createSessionCore = mock(
  async (_input: unknown) =>
    ({
      session: { id: "session-1", userId: "user-1" },
      chat: { id: "chat-1", sessionId: "session-1" },
    }) as unknown,
);
const getUserIdentity = mock(
  async (_userId: string) =>
    ({ username: "dennison", name: "Dennison" }) as unknown,
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

mock.module("@/lib/sessions/create-session", () => ({
  createSessionCore,
}));

mock.module("@/lib/db/users", () => ({
  getUserIdentity,
}));

mock.module("@/lib/db/sessions", () => ({
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

// #1241: sessions-write.ts pulls in registry.ts -> sessions-read.ts, which
// now queries this module for get_session's lastRunOutcome.
mock.module("@/lib/db/workflow-runs", () => ({
  getLatestWorkflowRunStatusBySessionId: mock(async () => null),
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

// `chats.active_stream_id` cannot be trusted raw — start-run.ts documents that
// a stale-but-clearable id reads non-null right up until reconciliation clears
// it, and production holds one such id that is 60 days old. stop_run resolves
// the slot through this instead of reading the column.
const reconcileChatRunSlot = mock(
  async (_chatId: string) =>
    ({ action: "ready", runId: null }) as {
      action: "resume" | "ready" | "conflict";
      runId: string | null;
    },
);

mock.module("@/lib/chat/start-run", () => ({
  startChatRun,
  stopChatRun,
  reconcileChatRunSlot,
}));

// archive_session calls archiveSession (lib/sandbox/archive-session.ts) IN
// PROCESS — never the HTTP route, which BotID blocks for headless callers in
// production. Its real implementation pulls in @open-agents/sandbox,
// @/lib/github/pulls, and @/lib/github/token, none of which this unit test
// needs, so the whole module is mocked at this boundary.
const archiveSession = mock(
  async (_sessionId: string, _options: unknown) =>
    ({
      session: { id: "session-1", userId: "user-1", status: "archived" },
      archiveTriggered: true,
    }) as unknown,
);

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession,
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

const TOOL_NAMES = [
  "open_agents_start_session",
  "open_agents_send_message",
  "open_agents_stop_run",
  "open_agents_archive_session",
];

function expectNoWriteIo(): void {
  expect(createSessionCore).not.toHaveBeenCalled();
  expect(getSessionMetadataById).not.toHaveBeenCalled();
  expect(getChatById).not.toHaveBeenCalled();
  expect(getChatsBySessionId).not.toHaveBeenCalled();
  expect(startChatRun).not.toHaveBeenCalled();
  expect(stopChatRun).not.toHaveBeenCalled();
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(archiveSession).not.toHaveBeenCalled();
}

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://mcp.test";
  createSessionCore.mockClear();
  getUserIdentity.mockClear();
  getUserIdentity.mockImplementation(async () => ({
    username: "dennison",
    name: "Dennison",
  }));
  createSessionCore.mockImplementation(
    async () =>
      ({
        session: { id: "session-1", userId: "user-1" },
        chat: { id: "chat-1", sessionId: "session-1" },
      }) as unknown,
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
  reconcileChatRunSlot.mockClear();
  reconcileChatRunSlot.mockImplementation(async () => ({
    action: "ready",
    runId: null,
  }));
  archiveSession.mockClear();
  archiveSession.mockImplementation(
    async () =>
      ({
        session: { id: "session-1", userId: "user-1", status: "archived" },
        archiveTriggered: true,
      }) as unknown,
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
    createSessionCore.mockImplementation(async (input) => {
      const data = input as Record<string, unknown>;
      expect(data.userId).toBe("user-1");
      // The username must reach createSessionCore, or a generated branch name
      // silently differs from what the browser would produce.
      expect(data.username).toBe("dennison");
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
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

  test("passes a cloneUrl, without which the sandbox clones nothing and the run bills against empty code", async () => {
    // A session created with repoOwner/repoName but no cloneUrl is treated by
    // the runtime as having no repo at all: no clone, no repo-access check, no
    // installation token — it initializes an empty git repo instead. The tool
    // would report success while the agent worked on nothing.
    const { startSession } = await toolsModulePromise;
    const received: Record<string, unknown>[] = [];
    createSessionCore.mockImplementation(async (input) => {
      received.push(input as Record<string, unknown>);
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "fix the login bug",
    });

    expect(received[0]?.cloneUrl).toBe("https://github.com/acme/widgets");
  });

  test("never runs the prewarm kick inline, which would hold the response open for the whole sandbox provisioning", async () => {
    // Observed in production: start_session created the session and started the
    // run, then never returned, because the scheduler invoked the prewarm
    // callback inline and sandbox provisioning takes minutes.
    const { startSession } = await toolsModulePromise;
    let invokedInline = false;
    createSessionCore.mockImplementation(async (input) => {
      const schedule = (input as Record<string, unknown>)
        .scheduleBackgroundWork as
        | ((cb: () => Promise<void>) => void)
        | undefined;
      expect(typeof schedule).toBe("function");
      schedule?.(async () => {
        invokedInline = true;
      });
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "go",
    });

    expect(invokedInline).toBe(false);
  });

  test("rejects a repo owner or name that is not a valid GitHub identifier", async () => {
    const { startSession } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;

    const promise = startSession(makeCtx({}), {
      repoOwner: "acme/../evil",
      repoName: "widgets",
      prompt: "do the thing",
    });

    await expect(promise).rejects.toBeInstanceOf(McpToolError);
    await expect(promise).rejects.toMatchObject({
      errorKind: "invalid_request",
    });
    expect(createSessionCore).not.toHaveBeenCalled();
  });

  test("requests a headless run: unattended:true and a builtin allowlist excluding ask_user_question (#1230)", async () => {
    const { startSession } = await toolsModulePromise;
    let capturedAgentOptions: Record<string, unknown> | undefined;
    startChatRun.mockImplementation(async (input) => {
      capturedAgentOptions = (input as Record<string, unknown>)
        .agentOptions as Record<string, unknown>;
      return { status: "started", runId: "run-new" };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
    });

    expect(capturedAgentOptions).toBeDefined();
    expect(capturedAgentOptions?.unattended).toBe(true);
    const allowlist = capturedAgentOptions?.allowedBuiltinToolNames as
      | string[]
      | undefined;
    expect(Array.isArray(allowlist)).toBe(true);
    expect(allowlist).not.toContain("ask_user_question");
    expect(typeof capturedAgentOptions?.customInstructions).toBe("string");
  });

  test("forwards autoCommit/autoCreatePr straight into createSessionCore — not into the workflow (#1230)", async () => {
    // Per the session-level override design: createSessionCore already
    // resolves autoCommitPush/autoCreatePr precedence (body > repo defaults >
    // user prefs) and persists the result on the session row, which every
    // later run on that session picks up. No workflow-level plumbing needed.
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      autoCommit: true,
      autoCreatePr: true,
    });

    expect(received?.autoCommitPush).toBe(true);
    expect(received?.autoCreatePr).toBe(true);
  });

  test("stores and returns a label supplied at creation", async () => {
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: {
          id: "session-new",
          userId: "user-1",
          label: (input as Record<string, unknown>).label,
        },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      label: "auth-refactor-2026-08-14",
    });

    expect(received?.label).toBe("auth-refactor-2026-08-14");
  });

  test("a session created without a label leaves createSessionCore's label input undefined — nothing else changes", async () => {
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
    });

    expect(received?.label).toBeUndefined();
  });

  test("BT-1246-01: defaults to isNewBranch:true, so auto-commit gets a fresh working branch instead of pushing onto the branch the caller named", async () => {
    // Production evidence (#1246): a session started with branch: "develop"
    // and no isNewBranch opinion committed directly onto develop, and the
    // push was rejected by branch protection — silently, with the run still
    // reported "completed". createSessionCore must receive isNewBranch:true
    // by default so it generates a fresh branch instead.
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      branch: "develop",
    });

    expect(received?.branch).toBe("develop");
    expect(received?.isNewBranch).toBe(true);
  });

  test("BT-1246-02: an explicit isNewBranch:false opts out and commits directly onto the named branch", async () => {
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      branch: "scratch/throwaway",
      isNewBranch: false,
    });

    expect(received?.branch).toBe("scratch/throwaway");
    expect(received?.isNewBranch).toBe(false);
  });

  test("BT-1246-03: an explicit isNewBranch:true is forwarded as-is (not just left to the default)", async () => {
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      isNewBranch: true,
    });

    expect(received?.isNewBranch).toBe(true);
  });

  test("regression: omitting branch entirely still defaults isNewBranch to true — the working-branch default does not depend on the caller naming a branch", async () => {
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
    });

    expect(received?.branch).toBeUndefined();
    expect(received?.isNewBranch).toBe(true);
  });

  test(".strict() still rejects an unknown key on start_session", async () => {
    const { runMcpTool } = await registryModulePromise;
    const { McpToolError } = await contextModulePromise;

    const promise = runMcpTool("open_agents_start_session", makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      unknownField: "nope",
    });

    await expect(promise).rejects.toBeInstanceOf(McpToolError);
    await expect(promise).rejects.toMatchObject({
      errorKind: "invalid_request",
    });
    expect(createSessionCore).not.toHaveBeenCalled();
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
    expect(createSessionCore).not.toHaveBeenCalled();
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
  test("refuses an archived session, so a token cannot start a run the browser blocks", async () => {
    // The browser route rejects a turn on an archived session because its
    // sandbox is torn down. Without the same guard here, an MCP token starts a
    // billable run against a workspace that no longer exists.
    const { sendMessage } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    seedSession(buildSessionRow({ status: "archived" }));

    const promise = sendMessage(makeCtx({}), {
      sessionId: "session-1",
      prompt: "keep going",
    });

    await expect(promise).rejects.toBeInstanceOf(McpToolError);
    await expect(promise).rejects.toMatchObject({
      errorKind: "invalid_request",
    });
    expect(startChatRun).not.toHaveBeenCalled();
  });

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

  test("requests a headless run: unattended:true and a builtin allowlist excluding ask_user_question (#1230)", async () => {
    const { sendMessage } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-1", sessionId: "session-1" },
    ]);
    let capturedAgentOptions: Record<string, unknown> | undefined;
    startChatRun.mockImplementation(async (input) => {
      capturedAgentOptions = (input as Record<string, unknown>)
        .agentOptions as Record<string, unknown>;
      return { status: "started", runId: "run-1" };
    });

    await sendMessage(makeCtx({}), {
      sessionId: "session-1",
      prompt: "keep going",
    });

    expect(capturedAgentOptions).toBeDefined();
    expect(capturedAgentOptions?.unattended).toBe(true);
    const allowlist = capturedAgentOptions?.allowedBuiltinToolNames as
      | string[]
      | undefined;
    expect(Array.isArray(allowlist)).toBe(true);
    expect(allowlist).not.toContain("ask_user_question");
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

  test("hands the chat's own run slot to stopChatRun rather than pre-judging it", async () => {
    // Classification belongs in stopChatRun, which can tell a run the runtime
    // no longer has (stale — cleared, nothing to stop) from a failure it
    // cannot classify (propagated). Deciding here via reconcileChatRunSlot
    // would clear the slot and report "nothing was running" on any transient
    // lookup error, while the billed run kept going.
    const { stopRun } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
      activeStreamId: "run-from-60-days-ago",
    }));
    stopChatRun.mockImplementation(async () => ({
      stopped: false,
      workflowRunId: null,
    }));

    const result = await stopRun(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(reconcileChatRunSlot).not.toHaveBeenCalled();
    expect(stopChatRun).toHaveBeenCalledWith({
      chatId: "chat-1",
      activeStreamId: "run-from-60-days-ago",
    });
    expect(result.stopped).toBe(false);
    expect(result.workflowRunId).toBeNull();
  });

  test("a live run is cancelled with the slot the chat holds", async () => {
    const { stopRun } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
      activeStreamId: "run-live",
    }));
    stopChatRun.mockImplementation(async () => ({
      stopped: true,
      workflowRunId: "run-live",
    }));

    const result = await stopRun(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
    });

    expect(stopChatRun).toHaveBeenCalledWith({
      chatId: "chat-1",
      activeStreamId: "run-live",
    });
    expect(result.stopped).toBe(true);
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

describe("archiveSession", () => {
  test("archives a session the caller owns and reports it was not already archived", async () => {
    const { archiveSession: archiveSessionTool } = await toolsModulePromise;
    seedSession(buildSessionRow({ status: "running" }));
    archiveSession.mockImplementation(async (sessionId, options) => {
      expect(sessionId).toBe("session-1");
      expect(
        typeof (options as Record<string, unknown>).scheduleBackgroundWork,
      ).toBe("function");
      return {
        session: { id: "session-1", userId: "user-1", status: "archived" },
        archiveTriggered: true,
      };
    });

    const result = await archiveSessionTool(makeCtx({}), {
      sessionId: "session-1",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      status: "archived",
      alreadyArchived: false,
    });
  });

  test("archiving twice is safe and reports nothing changed the second time", async () => {
    const { archiveSession: archiveSessionTool } = await toolsModulePromise;
    seedSession(buildSessionRow({ status: "archived" }));
    archiveSession.mockImplementation(async () => ({
      session: { id: "session-1", userId: "user-1", status: "archived" },
      // archiveSession's real contract: archiveTriggered is false when the
      // session was already archived, since nothing needed to change.
      archiveTriggered: false,
    }));

    const result = await archiveSessionTool(makeCtx({}), {
      sessionId: "session-1",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      status: "archived",
      alreadyArchived: true,
    });
  });

  test("a missing session and a session owned by a different user produce byte-identical not_found errors — never forbidden, which would reveal the session exists", async () => {
    const { archiveSession: archiveSessionTool } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    const ctx = makeCtx({ userId: "user-1" });

    seedSession(undefined);
    let missingError: unknown;
    try {
      await archiveSessionTool(ctx, { sessionId: "session-x" });
    } catch (error) {
      missingError = error;
    }

    seedSession(buildSessionRow({ id: "session-x", userId: "someone-else" }));
    let foreignError: unknown;
    try {
      await archiveSessionTool(ctx, { sessionId: "session-x" });
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
    expect(archiveSession).not.toHaveBeenCalled();
  });

  test(".strict() rejects an unknown key on archive_session", async () => {
    const { runMcpTool } = await registryModulePromise;
    const { McpToolError } = await contextModulePromise;

    const promise = runMcpTool("open_agents_archive_session", makeCtx({}), {
      sessionId: "session-1",
      unknownField: "nope",
    });

    await expect(promise).rejects.toBeInstanceOf(McpToolError);
    await expect(promise).rejects.toMatchObject({
      errorKind: "invalid_request",
    });
    expect(archiveSession).not.toHaveBeenCalled();
  });

  test("emits mcp.session.archived at info with ids/counts only, never the session's own content", async () => {
    const infoSpy = spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { archiveSession: archiveSessionTool } = await toolsModulePromise;
      seedSession(
        buildSessionRow({
          status: "running",
          sandboxState: { type: "vercel", sandboxName: "sbx-archive-1" },
        }),
      );
      archiveSession.mockImplementation(async () => ({
        session: { id: "session-1", userId: "user-1", status: "archived" },
        archiveTriggered: true,
      }));

      await archiveSessionTool(makeCtx({ requestId: "req-archive" }), {
        sessionId: "session-1",
      });

      const call = infoSpy.mock.calls.find(([, payload]) =>
        typeof payload === "string"
          ? payload.includes("mcp.session.archived")
          : false,
      );
      expect(call).toBeDefined();
      const logged = JSON.parse(call?.[1] as string) as Record<string, unknown>;
      expect(logged).toMatchObject({
        service: "mcp-server",
        event: "mcp.session.archived",
        requestId: "req-archive",
        userId: "user-1",
        sessionId: "session-1",
        sandboxName: "sbx-archive-1",
        alreadyArchived: false,
      });
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("regression: the scheduleBackgroundWork it passes defers work, rather than running it inline like archive-session.ts's own fire-and-forget default", async () => {
    // archiveSession's sandbox teardown (stopping the sandbox, refreshing
    // git/PR state) is real I/O that can take seconds — the same class of
    // problem #1230 already fixed for the sandbox prewarm kick. Passing
    // SOME function through (asserted elsewhere in this file) is not enough:
    // if `scheduleAfterResponse` is ever replaced with a callback that just
    // invokes its argument immediately, `archiveSession` (this tool) would
    // still call it and still forward a "function", but the deferral this
    // exists for would be silently gone. This calls the captured
    // scheduleBackgroundWork with a probe and proves the probe does not run
    // synchronously within it.
    const { archiveSession: archiveSessionTool } = await toolsModulePromise;
    seedSession(buildSessionRow({ status: "running" }));
    let capturedSchedule: ((cb: () => Promise<void>) => void) | undefined;
    archiveSession.mockImplementation(async (_sessionId, options) => {
      capturedSchedule = (options as Record<string, unknown>)
        .scheduleBackgroundWork as (cb: () => Promise<void>) => void;
      return {
        session: { id: "session-1", userId: "user-1", status: "archived" },
        archiveTriggered: true,
      };
    });

    await archiveSessionTool(makeCtx({}), { sessionId: "session-1" });

    let ranSynchronously = false;
    capturedSchedule?.(async () => {
      ranSynchronously = true;
    });
    expect(ranSynchronously).toBe(false);
  });
});

describe("regression: #1230 headless-run design decisions", () => {
  test("startSession and sendMessage forward the exact real buildHeadlessAgentOptions() output, not a hand-copied approximation", async () => {
    // A partial/field-by-field check (as the behavioral tests above do)
    // would not catch a regression where, say, customInstructions gets
    // dropped, or the allowlist filter regresses to include
    // ask_user_question again for one caller but not the other. Comparing
    // against the real module's own output closes that gap.
    const { startSession, sendMessage } = await toolsModulePromise;
    const { buildHeadlessAgentOptions } =
      await import("../headless-run-options");
    const expected = buildHeadlessAgentOptions();

    let startSessionAgentOptions: unknown;
    startChatRun.mockImplementation(async (input) => {
      startSessionAgentOptions = (input as Record<string, unknown>)
        .agentOptions;
      return { status: "started", runId: "run-a" };
    });
    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "go",
    });
    expect(startSessionAgentOptions).toEqual(expected);

    seedSession(buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-1", sessionId: "session-1" },
    ]);
    let sendMessageAgentOptions: unknown;
    startChatRun.mockImplementation(async (input) => {
      sendMessageAgentOptions = (input as Record<string, unknown>).agentOptions;
      return { status: "started", runId: "run-b" };
    });
    await sendMessage(makeCtx({}), {
      sessionId: "session-1",
      prompt: "keep going",
    });
    expect(sendMessageAgentOptions).toEqual(expected);
  });

  test("start_session forwards an explicit autoCommit:false rather than dropping it — a truthy-check regression would silently keep auto-commit on", async () => {
    // A naive `...(input.autoCommit ? { autoCommitPush: input.autoCommit } : {})`
    // forwarding pattern would omit the key entirely when the caller
    // explicitly opts OUT (autoCommit: false), letting createSessionCore fall
    // through to repo defaults / user preferences instead — the opposite of
    // what the caller asked for. The unconditional assignment this
    // implementation uses must forward `false` as `false`.
    const { startSession } = await toolsModulePromise;
    let received: Record<string, unknown> | undefined;
    createSessionCore.mockImplementation(async (input) => {
      received = input as Record<string, unknown>;
      return {
        session: { id: "session-new", userId: "user-1" },
        chat: { id: "chat-new", sessionId: "session-new" },
      };
    });

    await startSession(makeCtx({}), {
      repoOwner: "acme",
      repoName: "widgets",
      prompt: "build the thing",
      autoCommit: false,
      autoCreatePr: false,
    });

    expect(Object.hasOwn(received ?? {}, "autoCommitPush")).toBe(true);
    expect(received?.autoCommitPush).toBe(false);
    expect(Object.hasOwn(received ?? {}, "autoCreatePr")).toBe(true);
    expect(received?.autoCreatePr).toBe(false);
  });

  test("startSession emits mcp.run.started at info with ids/counts only — no prompt text", async () => {
    const infoSpy = spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { startSession } = await toolsModulePromise;
      startChatRun.mockImplementation(
        async () => ({ status: "started", runId: "run-started" }) as unknown,
      );

      await startSession(makeCtx({ requestId: "req-headless" }), {
        repoOwner: "acme",
        repoName: "widgets",
        prompt: "this prompt text must never be logged",
        autoCommit: true,
        autoCreatePr: false,
      });

      const call = infoSpy.mock.calls.find(([, payload]) =>
        typeof payload === "string"
          ? payload.includes("mcp.run.started")
          : false,
      );
      expect(call).toBeDefined();
      const logged = JSON.parse(call?.[1] as string) as Record<string, unknown>;
      // Default createSessionCore mock (see beforeEach) resolves session-1/chat-1.
      expect(logged).toMatchObject({
        service: "mcp-server",
        event: "mcp.run.started",
        requestId: "req-headless",
        userId: "user-1",
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "run-started",
        unattended: true,
        autoCommit: true,
        autoCreatePr: false,
      });
      expect(logged.deniedToolNames).toContain("ask_user_question");
      expect(JSON.stringify(logged)).not.toContain("this prompt text");
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("sendMessage emits mcp.run.started at info, with autoCommit/autoCreatePr null (no per-message override)", async () => {
    const infoSpy = spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { sendMessage } = await toolsModulePromise;
      seedSession(buildSessionRow());
      getChatsBySessionId.mockImplementation(async () => [
        { id: "chat-1", sessionId: "session-1" },
      ]);
      startChatRun.mockImplementation(
        async () => ({ status: "started", runId: "run-started-2" }) as unknown,
      );

      await sendMessage(makeCtx({ requestId: "req-headless-2" }), {
        sessionId: "session-1",
        prompt: "keep going",
      });

      const call = infoSpy.mock.calls.find(([, payload]) =>
        typeof payload === "string"
          ? payload.includes("mcp.run.started")
          : false,
      );
      expect(call).toBeDefined();
      const logged = JSON.parse(call?.[1] as string) as Record<string, unknown>;
      expect(logged).toMatchObject({
        service: "mcp-server",
        event: "mcp.run.started",
        requestId: "req-headless-2",
        userId: "user-1",
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "run-started-2",
        unattended: true,
        autoCommit: null,
        autoCreatePr: null,
      });
      expect(logged.deniedToolNames).toContain("ask_user_question");
    } finally {
      infoSpy.mockRestore();
    }
  });
});
