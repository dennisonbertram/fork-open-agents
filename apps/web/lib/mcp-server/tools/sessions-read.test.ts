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
// F2 fix contract: lightweight ownership/metadata projection (no cachedDiff)
// used by get_session and get_messages instead of the full-row getSessionById.
const getSessionMetadataById = mock(async () => undefined as unknown);
// F2 fix contract: diff-specific projection (includes cachedDiff) used only
// by get_diff_summary instead of the full-row getSessionById.
const getSessionDiffById = mock(async () => undefined as unknown);
// F1 fix contract: paginated query for the newest `limit` messages, already
// ordered oldest-to-newest, replacing the unbounded getChatMessages call.
const getRecentChatMessages = mock(
  async (_chatId: string, _limit: number) => [] as unknown[],
);
// F1 fix contract: total message count for the chat, independent of the page.
const countChatMessages = mock(async (_chatId: string) => 0);
// list_sessions reports an account-wide total, filtered the same way as the page.
const countSessionsByUserId = mock(
  async (_userId: string, _options?: { status?: string }) => 0,
);

mock.module("@/lib/db/sessions", () => ({
  getSessionsWithUnreadByUserId,
  getSessionById,
  getChatById,
  getChatsBySessionId,
  getChatSummariesBySessionId,
  getChatMessages,
  getSessionMetadataById,
  getSessionDiffById,
  getRecentChatMessages,
  countChatMessages,
  countSessionsByUserId,
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
    // A row whose lifecycle column says "active" but which holds no live
    // sandbox expiry — the shape 7 of 7 non-archived production sessions were
    // in, all of them reported as a ready workspace by the first cut.
    sandboxExpiresAt: null,
    cachedDiff: null,
    cachedDiffUpdatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:05:00Z"),
    lastActivityAt: new Date("2026-01-01T00:05:00Z"),
    ...overrides,
  };
}

// F2: buildSessionRow minus the cachedDiff fields — the shape the lightweight
// ownership/metadata projection is expected to select.
function buildSessionMetadataRow(overrides: Record<string, unknown> = {}) {
  const {
    cachedDiff: _cachedDiff,
    cachedDiffUpdatedAt: _cachedDiffUpdatedAt,
    ...row
  } = buildSessionRow(overrides) as Record<string, unknown>;
  return row;
}

// F2: the minimal diff-specific projection get_diff_summary is expected to use.
function buildSessionDiffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    cachedDiff: null,
    cachedDiffUpdatedAt: null,
    ...overrides,
  };
}

const TOOL_NAMES = [
  "open_agents_whoami",
  "open_agents_list_sessions",
  "open_agents_get_session",
  "open_agents_get_messages",
  "open_agents_get_diff_summary",
];

/**
 * Seed the session row every ownership path reads.
 *
 * The tools deliberately no longer call the full-row `getSessionById` — they
 * use the narrow projections so a metadata-only call never transfers a diff
 * body. A test that seeds only `getSessionById` therefore exercises nothing:
 * the projection returns undefined and the tool takes the "missing" branch, so
 * an ownership assertion would pass even with the ownership check deleted.
 * Seed all three so the row the test describes is the row the tool sees.
 */
function seedSession(row: unknown): void {
  getSessionById.mockImplementation(async () => row);
  getSessionMetadataById.mockImplementation(async () => row);
  getSessionDiffById.mockImplementation(async () => row);
}

/**
 * Seed a chat transcript across the paginated helpers. `getRecentChatMessages`
 * returns the newest `limit` rows oldest-to-newest (what the real query does
 * after its reverse) and `countChatMessages` reports the full total, so tests
 * keep asserting real windowing behavior rather than a pre-sliced array.
 */
function seedMessages(rows: unknown[]): void {
  getChatMessages.mockImplementation(async () => rows);
  getRecentChatMessages.mockImplementation(
    async (_chatId: string, limit: number) => rows.slice(-limit),
  );
  countChatMessages.mockImplementation(async () => rows.length);
}

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://mcp.test";
  getSessionsWithUnreadByUserId.mockClear();
  getSessionsWithUnreadByUserId.mockImplementation(async () => []);
  getSessionById.mockClear();
  seedSession(undefined);
  getChatById.mockClear();
  getChatById.mockImplementation(async () => undefined);
  getChatsBySessionId.mockClear();
  getChatsBySessionId.mockImplementation(async () => []);
  getChatSummariesBySessionId.mockClear();
  getChatSummariesBySessionId.mockImplementation(async () => []);
  getChatMessages.mockClear();
  seedMessages([]);
  getSessionMetadataById.mockClear();
  getSessionMetadataById.mockImplementation(async () => undefined);
  getSessionDiffById.mockClear();
  getSessionDiffById.mockImplementation(async () => undefined);
  getRecentChatMessages.mockClear();
  getRecentChatMessages.mockImplementation(async () => []);
  countChatMessages.mockClear();
  countChatMessages.mockImplementation(async () => 0);
  countSessionsByUserId.mockClear();
  countSessionsByUserId.mockImplementation(async () => 0);
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
  test("survives a string lastActivityAt, which is what the driver actually returns", async () => {
    // getSessionsWithUnreadByUserId declares lastActivityAt as Date, but it is
    // a raw `sql<Date>\`COALESCE(MAX(chats.updated_at), sessions.created_at)\``
    // expression (lib/db/sessions.ts) and postgres-js hands back a string for
    // it. Calling .toISOString() on that threw and turned every real
    // list_sessions call into internal_error — invisible to a mock that
    // returns a Date.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
        linesAdded: 1,
        linesRemoved: 2,
        prNumber: null,
        prStatus: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        hasUnread: false,
        hasStreaming: false,
        latestChatId: "chat-1",
        lastActivityAt: "2026-01-01 00:05:00+00" as unknown as Date,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.lastActivityAt).toBe(
      new Date("2026-01-01T00:05:00Z").toISOString(),
    );
  });

  test("reads a driver timestamp with no timezone as UTC, not as local time", async () => {
    // `bun test` forces TZ=UTC, which makes local-vs-UTC parsing bugs
    // structurally invisible here while the dev server (running in the
    // machine's real zone) shifts the value by the UTC offset. Pin a non-UTC
    // zone for this assertion so it can actually fail.
    const originalTz = process.env.TZ;
    process.env.TZ = "Europe/Prague";
    try {
      // The underlying column is `timestamp` (not timestamptz), so the driver
      // returns "2026-01-01 00:05:00" with no offset. `new Date(...)` on that
      // string resolves it in the machine's local zone, which shifted
      // lastActivityAt hours away from createdAt for the same instant. Drizzle's
      // own PgTimestamp mapper appends "+0000"; match it.
      const { listSessions } = await toolsModulePromise;
      getSessionsWithUnreadByUserId.mockImplementation(async () => [
        {
          id: "session-1",
          title: "Fix bug",
          status: "running",
          repoOwner: null,
          repoName: null,
          branch: null,
          linesAdded: null,
          linesRemoved: null,
          prNumber: null,
          prStatus: null,
          createdAt: new Date("2026-01-01T00:05:00Z"),
          hasUnread: false,
          hasStreaming: false,
          latestChatId: null,
          lastActivityAt: "2026-01-01 00:05:00" as unknown as Date,
        },
      ]);

      const result = await listSessions(makeCtx({}), {
        status: "active",
        limit: 20,
        offset: 0,
      });

      // Same instant expressed two ways must round-trip to the same string.
      expect(result.sessions[0]?.lastActivityAt).toBe(
        result.sessions[0]?.createdAt,
      );
      expect(result.sessions[0]?.lastActivityAt).toBe(
        "2026-01-01T00:05:00.000Z",
      );
    } finally {
      process.env.TZ = originalTz ?? "UTC";
    }
  });

  test("maps rows to the documented summary shape, scoped to the caller, including a web URL", async () => {
    const { listSessions } = await toolsModulePromise;
    // "ready" and "working" are claims about right now, so this row has to be
    // live right now: a sandbox expiring in an hour and a run slot claimed a
    // minute ago.
    const liveUntil = new Date(Date.now() + 60 * 60 * 1000);
    const justNow = new Date(Date.now() - 60 * 1000);
    getSessionsWithUnreadByUserId.mockImplementation(async (userId) => {
      expect(userId).toBe("user-1");
      return [
        {
          id: "session-1",
          title: "Fix bug",
          status: "running",
          lifecycleState: "active",
          sandboxExpiresAt: liveUntil,
          updatedAt: justNow,
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
          lastActivityAt: justNow,
        },
      ];
    });

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.returned).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      id: "session-1",
      title: "Fix bug",
      // status "running" + lifecycleState "active" + a live sandbox expiry is
      // a filed-active session whose workspace really is usable right now.
      state: "active",
      workspace: "ready",
      // Every non-archived session accepts a message — that is the only gate
      // the write path enforces — so `resumable` tracks filing, not workspace.
      resumable: true,
      activity: "working",
      repo: "acme/widgets",
      branch: "main",
      linesAdded: 0,
      linesRemoved: 5,
      prNumber: 42,
      prStatus: "open",
      hasUnread: true,
      isStreaming: true,
      latestChatId: "chat-1",
      lastActivityAt: justNow.toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      url: "https://mcp.test/sessions/session-1",
    });
  });

  test("does not report a workspace as ready once its sandbox expiry has passed", async () => {
    // The production shape: lifecycle_state 'active', sandbox_expires_at 226
    // hours in the past. "ready" is documented as "live and usable right now",
    // so an agent that reads it skips any warm-up and acts against a sandbox
    // that died nine days ago.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: "active",
        sandboxExpiresAt: new Date(Date.now() - 226 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 226 * 60 * 60 * 1000),
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
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
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.workspace).toBe("hibernated");
    expect(result.sessions[0]?.resumable).toBe(true);
  });

  test("does not report a run-slot older than any possible run as working", async () => {
    // Exactly one production chat holds a non-null active_stream_id, last
    // touched 60 days ago. `hasStreaming` reads it raw, and the codebase
    // documents that column as untrustworthy without reconciliation, so the
    // claim has to be bounded by time here.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: "hibernated",
        sandboxExpiresAt: null,
        updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
        linesAdded: 0,
        linesRemoved: 0,
        prNumber: null,
        prStatus: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        hasUnread: false,
        hasStreaming: true,
        latestChatId: "chat-1",
        lastActivityAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.activity).toBe("idle");
    // The raw column is still reported as-is under its own name, so the
    // bounded claim and the unbounded fact stay separable.
    expect(result.sessions[0]?.isStreaming).toBe(true);
  });

  test("reports a workspace stuck in provisioning as failed, so a poll loop terminates", async () => {
    // Seven production sessions have sat in 'provisioning' for between 19
    // hours and 81 days with nothing sweeping them. start_session tells the
    // caller to poll until the workspace reports ready.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: "provisioning",
        sandboxExpiresAt: null,
        updatedAt: new Date(Date.now() - 19 * 60 * 60 * 1000),
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
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
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.workspace).toBe("failed");
    expect(result.sessions[0]?.resumable).toBe(true);
  });

  test("reports a hibernated workspace as resumable and idle, not as a dead session", async () => {
    // Production reality this state model exists to describe honestly: a
    // session filed as "running" whose sandbox is hibernated (parked, no live
    // run) — the previous `status` field called this "running", which reads
    // as active work in progress. It is neither.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: "hibernated",
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
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.state).toBe("active");
    expect(result.sessions[0]?.workspace).toBe("hibernated");
    expect(result.sessions[0]?.resumable).toBe(true);
    expect(result.sessions[0]?.activity).toBe("idle");
  });

  test("reports an archived session with no workspace as state archived, workspace none", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "archived",
        lifecycleState: "archived",
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
      status: "archived",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.state).toBe("archived");
    expect(result.sessions[0]?.workspace).toBe("none");
    expect(result.sessions[0]?.resumable).toBe(false);
    expect(result.sessions[0]?.activity).toBe("idle");
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

    expect(result).toEqual({
      sessions: [],
      returned: 0,
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  test("takes the total from the page query itself, so page and total share one snapshot", async () => {
    // Two independent queries can observe different snapshots: the count can
    // run before an insert while the page runs after it, and a client told to
    // stop at offset + returned >= total then skips the new session. The page
    // query carries COUNT(*) OVER() so both come from one statement.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
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
        totalCount: 86,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 1,
      offset: 0,
    });

    expect(result.returned).toBe(1);
    expect(result.total).toBe(86);
    expect(countSessionsByUserId).not.toHaveBeenCalled();
  });

  test("falls back to a count query only when the page is empty and carries no window total", async () => {
    const { listSessions } = await toolsModulePromise;
    countSessionsByUserId.mockImplementation(async () => 86);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 500,
    });

    expect(result.returned).toBe(0);
    expect(result.total).toBe(86);
    expect(countSessionsByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
    });
  });

  test("reports the account-wide total alongside the page, so a client knows when to stop paging", async () => {
    // `count` used to mean "rows on this page", which is indistinguishable
    // from a total when the page happens to be full — a client paging through
    // 86 sessions saw count=50 and had no way to know more existed except by
    // requesting another page. get_messages already returns total + returned;
    // this makes list_sessions agree.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
        linesAdded: 0,
        linesRemoved: 0,
        prNumber: null,
        prStatus: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        hasUnread: false,
        hasStreaming: false,
        latestChatId: null,
        lastActivityAt: new Date("2026-01-01T00:00:00Z"),
        totalCount: 86,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 1,
      offset: 0,
    });

    expect(result.returned).toBe(1);
    expect(result.total).toBe(86);
    expect(result).not.toHaveProperty("count");
  });

  test("counts with the same status filter as the page it describes", async () => {
    const { listSessions } = await toolsModulePromise;
    countSessionsByUserId.mockImplementation(async () => 19);

    await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(countSessionsByUserId).toHaveBeenCalledWith("user-1", {
      status: "active",
    });
  });
});

describe("getSession ownership", () => {
  test("a missing session and a session owned by a different user produce byte-identical not_found errors", async () => {
    const { getSession } = await toolsModulePromise;
    const { McpToolError } = await contextModulePromise;
    const ctx = makeCtx({ userId: "user-1" });

    seedSession(undefined);
    let missingError: unknown;
    try {
      await getSession(ctx, { sessionId: "session-x" });
    } catch (error) {
      missingError = error;
    }

    seedSession(buildSessionRow({ id: "session-x", userId: "someone-else" }));
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
    seedSession(
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
    // buildSessionRow is filed active with lifecycleState "active" but no live
    // sandbox expiry, so its workspace is parked, not ready. `workspace` is
    // now the single answer to "is there a live sandbox" — the old separate
    // `sandboxActive` field is gone, because two fields answering the same
    // question is how they came to contradict each other.
    expect(result.state).toBe("active");
    expect(result.workspace).toBe("hibernated");
    expect(result.resumable).toBe(true);
    expect(result.activity).toBe("idle");
    expect("sandboxActive" in result).toBe(false);
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

  test("reports a ready workspace only while the sandbox expiry is still ahead", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(
      buildSessionRow({
        sandboxExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    );

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.workspace).toBe("ready");
  });

  test("does not report a 60-day-old run slot as working", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatSummariesBySessionId.mockImplementation(async () => [
      {
        id: "chat-1",
        title: "Chat one",
        hasUnread: false,
        isStreaming: true,
        lastAssistantMessageAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.activity).toBe("idle");
    expect(result.isStreaming).toBe(true);
  });
});

describe("getMessages", () => {
  test("returns the newest `limit` messages, oldest-to-newest, plus the full total", async () => {
    const { getMessages } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    seedMessages([
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
    seedSession(buildSessionRow());
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-most-recent", sessionId: "session-1" },
      { id: "chat-older", sessionId: "session-1" },
    ]);
    seedMessages([]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      limit: 20,
    });

    expect(result.chatId).toBe("chat-most-recent");
  });

  test("truncates each preview to MESSAGE_PREVIEW_CHARS and flags tool calls", async () => {
    const { getMessages, MESSAGE_PREVIEW_CHARS } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const longText = "x".repeat(MESSAGE_PREVIEW_CHARS + 50);
    seedMessages([
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
    seedSession(buildSessionRow({ userId: "someone-else" }));
    // Seed a readable chat and transcript too. Without this the tool would
    // fall through to "session has no chats" — also a not_found — and the
    // assertions below would pass even with the ownership check deleted.
    getChatsBySessionId.mockImplementation(async () => [
      { id: "chat-1", sessionId: "session-1", title: "Chat one" },
    ]);
    seedMessages([
      {
        id: "message-1",
        role: "user",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        parts: [{ type: "text", text: "hello" }],
      },
    ]);

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
    seedSession(buildSessionRow());
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
    seedSession(buildSessionRow());
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
    seedSession(buildSessionRow({ userId: "someone-else" }));

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
    seedSession(
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
    seedSession(
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

// --- F1: get_messages must not load the whole transcript to return a page ---
describe("getMessages pagination (perf fix F1)", () => {
  test("queries only the newest `limit` rows via getRecentChatMessages, not the unbounded getChatMessages", async () => {
    const { getMessages } = await toolsModulePromise;
    // Seeded so today's implementation (still on getSessionById) reaches the
    // message-fetching code instead of failing early on ownership.
    seedSession(buildSessionRow());
    getSessionMetadataById.mockImplementation(async () =>
      buildSessionMetadataRow(),
    );
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    // Contract: getRecentChatMessages returns its page already oldest-to-newest.
    getRecentChatMessages.mockImplementation(async () => [
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
    // Full chat has 3 messages; only the newest 2 are requested.
    countChatMessages.mockImplementation(async () => 3);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 2,
    });

    expect(getRecentChatMessages).toHaveBeenCalledWith("chat-1", 2);
    expect(getChatMessages).not.toHaveBeenCalled();
    expect(countChatMessages).toHaveBeenCalledWith("chat-1");
    // total comes from the count query, not from the returned page length.
    expect(result.total).toBe(3);
    expect(result.returned).toBe(2);
    expect(result.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
  });
});

// --- F2: ownership/metadata path must not load the cached diff ---
describe("ownership projection avoids loading cached diff bodies (perf fix F2)", () => {
  test("get_session uses the lightweight metadata projection, never the full-row/cached-diff helper", async () => {
    const { getSession } = await toolsModulePromise;
    // Seeded so today's implementation (still on getSessionById) reaches the
    // rest of the handler instead of failing early on ownership.
    seedSession(
      buildSessionRow({ sandboxState: { type: "vercel", expiresAt: 0 } }),
    );
    getSessionMetadataById.mockImplementation(async () =>
      buildSessionMetadataRow({
        sandboxState: { type: "vercel", expiresAt: 0 },
      }),
    );
    getChatSummariesBySessionId.mockImplementation(async () => []);

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(getSessionMetadataById).toHaveBeenCalledWith("session-1");
    expect(getSessionById).not.toHaveBeenCalled();
    expect(result.id).toBe("session-1");
  });

  test("get_messages uses the lightweight metadata projection for ownership, never the full-row/cached-diff helper", async () => {
    const { getMessages } = await toolsModulePromise;
    // Seeded so today's implementation (still on getSessionById) reaches the
    // rest of the handler instead of failing early on ownership.
    seedSession(buildSessionRow());
    getSessionMetadataById.mockImplementation(async () =>
      buildSessionMetadataRow(),
    );
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    getRecentChatMessages.mockImplementation(async () => []);
    countChatMessages.mockImplementation(async () => 0);

    await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });

    expect(getSessionMetadataById).toHaveBeenCalledWith("session-1");
    expect(getSessionById).not.toHaveBeenCalled();
  });

  test("get_diff_summary uses the diff-specific projection, never the lightweight metadata projection", async () => {
    const { getDiffSummary } = await toolsModulePromise;
    const cachedDiff = {
      files: [],
      baseRef: "origin/main",
      summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 },
    };
    const cachedDiffUpdatedAt = new Date("2026-01-03T00:00:00Z");
    // Seeded so today's implementation (still on getSessionById) reaches the
    // rest of the handler instead of failing early on ownership.
    seedSession(buildSessionRow({ cachedDiff, cachedDiffUpdatedAt }));
    getSessionDiffById.mockImplementation(async () =>
      buildSessionDiffRow({ cachedDiff, cachedDiffUpdatedAt }),
    );

    const result = await getDiffSummary(makeCtx({}), {
      sessionId: "session-1",
    });

    expect(getSessionDiffById).toHaveBeenCalledWith("session-1");
    expect(getSessionMetadataById).not.toHaveBeenCalled();
    expect(getSessionById).not.toHaveBeenCalled();
    expect(result.hasCachedDiff).toBe(true);
  });
});
