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

// #1241: get_session's `lastRunOutcome` field. get_session only, never
// list_sessions — issued once per call against the session_id index, so it
// never becomes an N+1 across a page of sessions.
const getLatestWorkflowRunStatusBySessionId = mock(
  async (_sessionId: string) => null as string | null,
);
// #1270: open_agents_get_updates. The handler loads this lazily via a dynamic
// import (so the static import graph stays free of it — registry tests mock
// this module with only getLatestWorkflowRunStatusBySessionId), but the mock
// must still export it for the dynamic import inside the handler to resolve.
const getWorkflowRunsFinishedSince = mock(
  async (_input: unknown) => [] as unknown[],
);
mock.module("@/lib/db/workflow-runs", () => ({
  getLatestWorkflowRunStatusBySessionId,
  getWorkflowRunsFinishedSince,
}));

// #1246: get_session's auto-commit/auto-PR failure signal. Records every
// call's `eventNames` argument (in call order) so a test can tell the
// auto-commit lookup apart from the auto-pr lookup without depending on
// which one sessions-read.ts happens to call first.
const getLatestSessionEventByNames = mock(
  async (_params: { sessionId: string; eventNames: readonly string[] }) =>
    null as unknown,
);
mock.module("@/lib/observability/session-event-lookup", () => ({
  getLatestSessionEventByNames,
}));

const toolsModulePromise = import("./sessions-read");
const registryModulePromise = import("../registry");
const contextModulePromise = import("../context");
const toolTraceModulePromise = import("../tool-trace");

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
    baseBranch: null,
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

// #1270: the shape getWorkflowRunsFinishedSince returns — a finished run joined
// to its session's summary columns. The query itself is what enforces
// "finished since" and caller scope, so these fixtures represent already-
// filtered rows (a still-running session has no finished run row at all).
function buildFinishedRunRow(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    sessionId: "session-1",
    status: "completed",
    finishedAt: new Date("2026-01-01T00:05:00Z"),
    title: "Fix the bug",
    label: null,
    branch: "main",
    baseBranch: null,
    prNumber: null,
    prStatus: null,
    totalCount: 1,
    ...overrides,
  };
}

const TOOL_NAMES = [
  "open_agents_whoami",
  "open_agents_list_sessions",
  "open_agents_get_session",
  "open_agents_get_messages",
  "open_agents_get_diff_summary",
  "open_agents_get_updates",
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
  getLatestWorkflowRunStatusBySessionId.mockClear();
  getLatestWorkflowRunStatusBySessionId.mockImplementation(async () => null);
  getWorkflowRunsFinishedSince.mockClear();
  getWorkflowRunsFinishedSince.mockImplementation(async () => []);
  getLatestSessionEventByNames.mockClear();
  getLatestSessionEventByNames.mockImplementation(async () => null);
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
          label: "auth-refactor-2026-08-14",
          lastRunStatus: "completed",
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
      lastRunOutcome: "completed",
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
      label: "auth-refactor-2026-08-14",
    });
  });

  test("returns null label (not undefined, not an error) for a session created without one", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: null,
        sandboxExpiresAt: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
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
        label: null,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.label).toBeNull();
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
        activeRunSlotAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
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

  test("bounds staleness by the chat that holds the run slot, not by the session's newest chat", async () => {
    // `hasStreaming` is BOOL_OR(active_stream_id IS NOT NULL) across all of a
    // session's chats, while `lastActivityAt` is MAX(chats.updated_at) — two
    // independent aggregates. A session with a stale slot on one chat and a
    // fresh message on another therefore pairs "a run is claimed" with a
    // timestamp belonging to a different chat, and the staleness bound never
    // fires. The timestamp has to come from the chat holding the slot.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: "hibernated",
        sandboxExpiresAt: null,
        updatedAt: new Date(Date.now() - 60 * 1000),
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
        latestChatId: "chat-2",
        // Newest chat activity: a minute ago, on a chat with no run slot.
        lastActivityAt: new Date(Date.now() - 60 * 1000),
        // The chat that actually holds the slot was last touched 60 days ago.
        activeRunSlotAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.activity).toBe("idle");
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

// A dispatcher fanning out several sessions polls list_sessions, not
// get_session per session (an N+1 poll). Before this, `lastRunOutcome` was
// only on get_session's output, so a stalled run (`activity: "idle"`,
// `state: "active"` — indistinguishable from a healthy finish) was invisible
// to that poll. list_sessions must expose the same field, with the same
// vocabulary and the same null-when-never-run rule.
describe("listSessions lastRunOutcome", () => {
  function buildListRow(overrides: Record<string, unknown> = {}) {
    return {
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
      ...overrides,
    };
  }

  test("reports null for a session that has never run", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      buildListRow({ lastRunStatus: null }),
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.lastRunOutcome).toBeNull();
  });

  test("reports a stall value (awaiting_tool_approval), not just idle activity", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      buildListRow({ lastRunStatus: "awaiting_tool_approval" }),
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    expect(result.sessions[0]?.lastRunOutcome).toBe("awaiting_tool_approval");
  });

  test("a fan-out poll can tell a stalled session apart from a healthy idle finish, which activity alone cannot", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      buildListRow({
        id: "session-stalled",
        lastRunStatus: "awaiting_tool_approval",
      }),
      buildListRow({ id: "session-finished", lastRunStatus: "completed" }),
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "active",
      limit: 20,
      offset: 0,
    });

    // Neither row has a live run slot, so both report the same idle activity —
    // only lastRunOutcome tells the stall apart from the finish.
    expect(result.sessions[0]?.activity).toBe("idle");
    expect(result.sessions[1]?.activity).toBe("idle");
    expect(result.sessions[0]?.lastRunOutcome).toBe("awaiting_tool_approval");
    expect(result.sessions[1]?.lastRunOutcome).toBe("completed");
  });

  test("list_sessions' real result conforms to its advertised outputSchema for every outcome", async () => {
    const { listSessions, sessionReadTools } = await toolsModulePromise;
    const listSessionsDef = sessionReadTools.find(
      (def) => def.name === "open_agents_list_sessions",
    );
    if (!listSessionsDef) {
      throw new Error("open_agents_list_sessions not registered");
    }

    for (const status of [
      null,
      "completed",
      "awaiting_tool_approval",
      "no_progress_fuse",
      "diff_violation",
    ] as const) {
      getSessionsWithUnreadByUserId.mockImplementation(async () => [
        buildListRow({ lastRunStatus: status }),
      ]);

      const result = await listSessions(makeCtx({}), {
        status: "active",
        limit: 20,
        offset: 0,
      });

      const parsed = listSessionsDef.outputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("listSessions label filter", () => {
  test("forwards the label filter into the page query", async () => {
    const { listSessions } = await toolsModulePromise;

    await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
      label: "auth-refactor-2026-08-14",
    });

    expect(getSessionsWithUnreadByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
      limit: 20,
      offset: 0,
      label: "auth-refactor-2026-08-14",
      sort: "created_desc",
    });
  });

  test("returns exactly the batch sharing a label, with a total scoped to that same filter", async () => {
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: null,
        sandboxExpiresAt: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
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
        label: "auth-refactor-2026-08-14",
        // The batch has 5 members; this filtered query's own window total —
        // NOT the account-wide 94 — is what a client should see.
        totalCount: 5,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
      label: "auth-refactor-2026-08-14",
    });

    expect(result.total).toBe(5);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.label).toBe("auth-refactor-2026-08-14");
  });

  test("falls back to a label-scoped count query when the filtered page is empty", async () => {
    const { listSessions } = await toolsModulePromise;
    countSessionsByUserId.mockImplementation(async () => 0);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
      label: "nonexistent-label",
    });

    expect(result.total).toBe(0);
    expect(countSessionsByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
      label: "nonexistent-label",
    });
  });

  test("omitting label filters nothing and does not pass a label key to the page query", async () => {
    const { listSessions } = await toolsModulePromise;

    await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(getSessionsWithUnreadByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
      limit: 20,
      offset: 0,
      sort: "created_desc",
    });
  });

  test("regression: a non-empty filtered page never triggers a second count query — label reuses #1184's single-query total", async () => {
    // #1184 established that `total` must come from the page query's own
    // COUNT(*) OVER() rather than a second COUNT — two separate queries can
    // observe two different snapshots, and a client stopping at
    // offset + returned >= total then silently skips a row inserted between
    // them. That guarantee is only as good as every filter staying inside
    // the one query. A future edit that special-cases the label filter into
    // its own COUNT (easy to reach for, since `label` is new) would
    // reintroduce exactly the bug #1184 fixed, just for filtered callers
    // instead of all of them — and every other label test here mocks
    // `countSessionsByUserId` to return a harmless value, so none of them
    // would catch it. This is the one that does: it fails loudly if the
    // count function is called at all on a non-empty labeled page.
    const { listSessions } = await toolsModulePromise;
    getSessionsWithUnreadByUserId.mockImplementation(async () => [
      {
        id: "session-1",
        title: "Fix bug",
        status: "running",
        lifecycleState: null,
        sandboxExpiresAt: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
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
        label: "auth-refactor-2026-08-14",
        totalCount: 5,
      },
    ]);

    const result = await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
      label: "auth-refactor-2026-08-14",
    });

    expect(result.total).toBe(5);
    expect(countSessionsByUserId).not.toHaveBeenCalled();
  });
});

describe("listSessions sort", () => {
  test("defaults to created_desc — existing callers see unchanged behavior", async () => {
    const { listSessions } = await toolsModulePromise;

    await listSessions(makeCtx({}), { status: "all", limit: 20, offset: 0 });

    expect(getSessionsWithUnreadByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
      limit: 20,
      offset: 0,
      sort: "created_desc",
    });
  });

  test.each([
    ["created_desc"],
    ["created_asc"],
    ["activity_desc"],
    ["activity_asc"],
  ])("forwards an explicit sort=%s into the page query", async (sort) => {
    const { listSessions } = await toolsModulePromise;

    await listSessions(makeCtx({}), {
      status: "all",
      limit: 20,
      offset: 0,
      sort: sort as "created_desc",
    });

    expect(getSessionsWithUnreadByUserId).toHaveBeenCalledWith("user-1", {
      status: "all",
      limit: 20,
      offset: 0,
      sort,
    });
  });

  test("rejects an unsupported sort value as invalid_request via the schema", async () => {
    const { runMcpTool } = await registryModulePromise;
    const { McpToolError } = await contextModulePromise;

    const promise = runMcpTool("open_agents_list_sessions", makeCtx({}), {
      status: "all",
      sort: "alphabetical",
    });

    await expect(promise).rejects.toBeInstanceOf(McpToolError);
    await expect(promise).rejects.toMatchObject({
      errorKind: "invalid_request",
    });
    expect(getSessionsWithUnreadByUserId).not.toHaveBeenCalled();
  });

  test("a full paged walk under every sort collects every row exactly once", async () => {
    // A minimal fake page query standing in for the real SQL: it filters,
    // sorts (deterministically, tiebroken by id — the same guarantee
    // `buildSessionsOrderBy` provides for real), and paginates an in-memory
    // fixture that deliberately gives several rows an IDENTICAL createdAt and
    // lastActivityAt — the exact fan-out shape (several sessions started in
    // one burst) that makes an undertiebroken sort skip or repeat rows across
    // separate LIMIT/OFFSET pages.
    const { listSessions } = await toolsModulePromise;
    const tiedTimestamp = new Date("2026-08-14T00:00:00Z");
    const fixture = Array.from({ length: 11 }, (_, i) => ({
      id: `session-${i}`,
      title: `Session ${i}`,
      status: "running",
      lifecycleState: null,
      sandboxExpiresAt: null,
      updatedAt: tiedTimestamp,
      repoOwner: null,
      repoName: null,
      branch: null,
      linesAdded: 0,
      linesRemoved: 0,
      prNumber: null,
      prStatus: null,
      createdAt: tiedTimestamp,
      hasUnread: false,
      hasStreaming: false,
      latestChatId: null,
      lastActivityAt: tiedTimestamp,
      label: "batch",
    }));

    const sortedIdsAsc = [...fixture]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => row.id);
    // Every tied row shares createdAt/lastActivityAt, so — same as the real
    // SQL — the only thing that can distinguish "created_desc" from
    // "activity_desc" here is that each is independently tiebroken by id.
    // Keying strictly off the `sort` value the mock actually receives (not a
    // value captured from the outer loop) is what makes this test fail if
    // `listSessions` ever stops forwarding `sort` to the page query.
    const ordersBySort: Record<string, string[]> = {
      created_desc: [...sortedIdsAsc].toReversed(),
      created_asc: sortedIdsAsc,
      activity_desc: [...sortedIdsAsc].toReversed(),
      activity_asc: sortedIdsAsc,
    };

    getSessionsWithUnreadByUserId.mockImplementation(
      async (_userId, options) => {
        const opts = options as {
          limit: number;
          offset: number;
          sort?: string;
        };
        const orderedIds = ordersBySort[opts.sort ?? ""];
        if (!orderedIds) {
          // sort was not forwarded (or forwarded as something unsupported):
          // the real query has nothing to sort by, so report an empty page
          // rather than guessing — the walk below then collects 0 rows.
          return [];
        }
        const page = orderedIds
          .slice(opts.offset, opts.offset + opts.limit)
          .map((id) => fixture.find((row) => row.id === id));
        return page.map((row) => ({
          ...(row as (typeof fixture)[number]),
          totalCount: fixture.length,
        }));
      },
    );

    for (const sort of [
      "created_desc",
      "created_asc",
      "activity_desc",
      "activity_asc",
    ] as const) {
      const orderedIds = ordersBySort[sort] as string[];
      const pageSize = 3;
      const collected: string[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const page = await listSessions(makeCtx({}), {
          status: "all",
          limit: pageSize,
          offset,
          sort,
        });
        total = page.total;
        collected.push(...page.sessions.map((s) => s.id));
        offset += page.returned;
        if (page.returned === 0) {
          break;
        }
      }

      expect(collected).toHaveLength(fixture.length);
      expect(new Set(collected).size).toBe(fixture.length);
      expect(collected).toEqual(orderedIds);
    }
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

  test("BT-1246-04: reports both fields null when no auto-commit/auto-PR event has ever been recorded for the session", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.lastAutoCommitEvent).toBeNull();
    expect(result.lastAutoPrEvent).toBeNull();
  });

  test("BT-1246-05: surfaces the latest auto-commit failure verbatim — the MCP-visible signal session_events already carried but no reader exposed", async () => {
    // Reproduces the production defect (#1246): workflow.auto_commit.failed
    // was recorded with the exact rejection reason, but get_session reported
    // prNumber: null and nothing else — an MCP client had no way to learn the
    // work was never saved.
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getLatestSessionEventByNames.mockImplementation(async ({ eventNames }) => {
      if (eventNames.includes("workflow.auto_commit.failed")) {
        return {
          id: "event-1",
          sessionId: "session-1",
          eventName: "workflow.auto_commit.failed",
          status: "failed",
          summary:
            "Auto-commit failed: Changes must be made through a pull request. 3 of 3 required status checks are expected.",
          createdAt: "2026-08-14T12:17:51.000Z",
        };
      }
      return null;
    });

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.lastAutoCommitEvent).toEqual({
      eventName: "workflow.auto_commit.failed",
      status: "failed",
      summary:
        "Auto-commit failed: Changes must be made through a pull request. 3 of 3 required status checks are expected.",
      occurredAt: "2026-08-14T12:17:51.000Z",
    });
    expect(result.lastAutoPrEvent).toBeNull();
  });

  test("BT-1246-06: surfaces the latest auto-PR skip verbatim, independently of the auto-commit event", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getLatestSessionEventByNames.mockImplementation(async ({ eventNames }) => {
      if (eventNames.includes("workflow.auto_pr.skipped")) {
        return {
          id: "event-2",
          sessionId: "session-1",
          eventName: "workflow.auto_pr.skipped",
          status: "skipped",
          summary:
            "Auto-commit failed: Changes must be made through a pull request.",
          createdAt: "2026-08-14T12:17:54.000Z",
        };
      }
      return null;
    });

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.lastAutoPrEvent).toEqual({
      eventName: "workflow.auto_pr.skipped",
      status: "skipped",
      summary:
        "Auto-commit failed: Changes must be made through a pull request.",
      occurredAt: "2026-08-14T12:17:54.000Z",
    });
    expect(result.lastAutoCommitEvent).toBeNull();
  });

  test("regression: queries the auto-commit and auto-pr event-name sets separately, both scoped to the session id — a merged query would risk one masking the other's status", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow({ id: "session-9" }));

    await getSession(makeCtx({}), { sessionId: "session-9" });

    expect(getLatestSessionEventByNames).toHaveBeenCalledTimes(2);
    const calls = getLatestSessionEventByNames.mock.calls.map(
      ([params]) =>
        params as { sessionId: string; eventNames: readonly string[] },
    );
    for (const call of calls) {
      expect(call.sessionId).toBe("session-9");
    }
    const commitCall = calls.find((call) =>
      call.eventNames.includes("workflow.auto_commit.failed"),
    );
    const prCall = calls.find((call) =>
      call.eventNames.includes("workflow.auto_pr.failed"),
    );
    expect(commitCall).toBeDefined();
    expect(prCall).toBeDefined();
    // The two sets must not overlap — otherwise a PR event could win the
    // "most recent" comparison for the commit field, or vice versa.
    for (const name of commitCall?.eventNames ?? []) {
      expect(prCall?.eventNames).not.toContain(name);
    }
  });

  test("regression: a failed git-automation event lookup degrades to null rather than failing the whole get_session call", async () => {
    // get_session is the caller's primary read tool — a transient failure in
    // this brand-new side lookup (a DB hiccup, a bad query) must not take the
    // rest of the session detail down with it.
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getLatestSessionEventByNames.mockImplementation(async ({ eventNames }) => {
      if (eventNames.includes("workflow.auto_commit.failed")) {
        throw new Error("db unavailable");
      }
      return null;
    });

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.id).toBe("session-1");
    expect(result.lastAutoCommitEvent).toBeNull();
    expect(result.lastAutoPrEvent).toBeNull();
  });

  test("BT-1251-11: reports the session's baseBranch so a client can confirm what its slice actually started from", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(
      buildSessionRow({ branch: "d/abc12345", baseBranch: "develop" }),
    );

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.branch).toBe("d/abc12345");
    expect(result.baseBranch).toBe("develop");
  });

  test("regression: a session with no recorded base branch reports baseBranch: null, not undefined", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow({ baseBranch: null }));

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.baseBranch).toBeNull();
  });
});

/**
 * #1241: get_session reports how the last run ended — a third axis distinct
 * from `state` (filing) and `activity` (is a run live right now). Before
 * this, a stalled run, a step-capped run, a crash, and a clean finish all
 * reported identically through this tool.
 */
describe("getSession lastRunOutcome (#1241)", () => {
  test("a session with no run yet reports null", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getLatestWorkflowRunStatusBySessionId.mockImplementation(async () => null);

    const result = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(result.lastRunOutcome).toBeNull();
    expect(getLatestWorkflowRunStatusBySessionId).toHaveBeenCalledWith(
      "session-1",
    );
  });

  test.each([
    "completed",
    "aborted",
    "failed",
    "no_progress_fuse",
    "no_sandbox_step_cap",
    "max_steps",
    "repeated_tool_failure",
    // #1247
    "truncated",
    "awaiting_tool_approval",
    "ended_unexpectedly",
    // #1288
    "no_file_changes",
    "step_ceiling",
    "diff_violation",
  ] as const)(
    "reports %s through get_session with the writer's own vocabulary",
    async (status) => {
      const { getSession } = await toolsModulePromise;
      seedSession(buildSessionRow());
      getLatestWorkflowRunStatusBySessionId.mockImplementation(
        async () => status,
      );

      const result = await getSession(makeCtx({}), {
        sessionId: "session-1",
      });

      expect(result.lastRunOutcome).toBe(status);
    },
  );

  test("a crash is distinguishable from the no-progress fuse", async () => {
    const { getSession } = await toolsModulePromise;
    seedSession(buildSessionRow());

    getLatestWorkflowRunStatusBySessionId.mockImplementation(
      async () => "failed",
    );
    const crashed = await getSession(makeCtx({}), { sessionId: "session-1" });

    getLatestWorkflowRunStatusBySessionId.mockImplementation(
      async () => "no_progress_fuse",
    );
    const fused = await getSession(makeCtx({}), { sessionId: "session-1" });

    expect(crashed.lastRunOutcome).toBe("failed");
    expect(fused.lastRunOutcome).toBe("no_progress_fuse");
    expect(crashed.lastRunOutcome).not.toBe(fused.lastRunOutcome);
  });

  test("get_session's real result conforms to its advertised outputSchema for every outcome", async () => {
    const { getSession } = await toolsModulePromise;
    const { sessionReadTools } = await toolsModulePromise;
    const getSessionDef = sessionReadTools.find(
      (def) => def.name === "open_agents_get_session",
    );
    if (!getSessionDef) {
      throw new Error("open_agents_get_session not registered");
    }

    seedSession(buildSessionRow());

    for (const status of [
      null,
      "completed",
      "no_progress_fuse",
      "no_sandbox_step_cap",
      "max_steps",
      "repeated_tool_failure",
      // #1247
      "truncated",
      "awaiting_tool_approval",
      "ended_unexpectedly",
      // #1288
      "no_file_changes",
      "step_ceiling",
      "diff_violation",
    ] as const) {
      getLatestWorkflowRunStatusBySessionId.mockImplementation(
        async () => status,
      );
      const result = await getSession(makeCtx({}), {
        sessionId: "session-1",
      });
      const parsed = getSessionDef.outputSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    }
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

  test("returns each message's full text (no 280-char preview cap) and flags tool calls", async () => {
    const { getMessages } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const longText = "x".repeat(330);
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
    expect(first?.text).toBe(longText);
    expect(first?.chars).toBe(330);
    expect(first?.capped).toBe(false);
    expect(first?.hasToolCalls).toBe(false);
    expect(second?.text).toBe("short reply");
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

// --- #1232: get_messages must return full text, an opt-in tool trace, and a
// truthfully-reported response budget instead of a 280-char preview that
// silently dropped every tool call. ---
describe("getMessages full text and tool trace (#1232)", () => {
  test("returns a message's full text even past the old 280-char preview cap", async () => {
    const { getMessages } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const longText = "y".repeat(5000);
    seedMessages([
      {
        id: "m1",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        parts: [{ type: "text", text: longText }],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });

    expect(result.messages[0]?.text).toBe(longText);
    expect(result.messages[0]?.chars).toBe(5000);
    expect(result.messages[0]?.capped).toBe(false);
  });

  test("caps text at messageCharLimit and flags it capped, while chars still reports the true length", async () => {
    const { getMessages } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const text = "z".repeat(500);
    seedMessages([
      {
        id: "m1",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        parts: [{ type: "text", text }],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
      messageCharLimit: 200,
    });

    expect(result.messages[0]?.text).toBe(text.slice(0, 200));
    expect(result.messages[0]?.text.length).toBe(200);
    expect(result.messages[0]?.capped).toBe(true);
    expect(result.messages[0]?.chars).toBe(500);
  });

  test("does not cap text when messageCharLimit is omitted", async () => {
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
        parts: [{ type: "text", text: "hello there" }],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });

    expect(result.messages[0]?.capped).toBe(false);
    expect(result.messages[0]?.text).toBe("hello there");
  });

  test("returns an ordered, bounded tool trace only when includeToolTrace is true", async () => {
    const { getMessages } = await toolsModulePromise;
    const { TOOL_TRACE_FIELD_CHARS } = await toolTraceModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    const bigOutput = { stdout: "x".repeat(TOOL_TRACE_FIELD_CHARS + 500) };
    seedMessages([
      {
        id: "m1",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        parts: [
          { type: "text", text: "ran a command" },
          {
            type: "tool-bash",
            toolCallId: "call-1",
            state: "output-available",
            input: { command: "ls" },
            output: bigOutput,
          },
        ],
      },
    ]);

    const withoutTrace = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });
    expect(withoutTrace.messages[0]?.toolTrace).toBeUndefined();
    expect(withoutTrace.messages[0]?.hasToolCalls).toBe(true);

    const withTrace = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
      includeToolTrace: true,
    });
    const trace = withTrace.messages[0]?.toolTrace;
    expect(trace).toHaveLength(1);
    expect(trace?.[0]?.toolCallId).toBe("call-1");
    expect(trace?.[0]?.name).toBe("bash");
    expect(trace?.[0]?.state).toBe("output-available");
    expect(trace?.[0]?.input).toBe(JSON.stringify({ command: "ls" }));
    expect(trace?.[0]?.inputTruncated).toBe(false);
    // The raw output is bigger than the per-field bound, so it must be cut
    // AND flagged — never a silent shortening.
    expect(trace?.[0]?.output.length ?? 0).toBe(TOOL_TRACE_FIELD_CHARS);
    expect(trace?.[0]?.outputTruncated).toBe(true);
  });

  test("a response exceeding the character budget truthfully reports truncated and omitted, dropping nothing silently", async () => {
    const { getMessages, RESPONSE_CHAR_BUDGET } = await toolsModulePromise;
    seedSession(buildSessionRow());
    getChatById.mockImplementation(async () => ({
      id: "chat-1",
      sessionId: "session-1",
    }));
    // Five messages whose combined text comfortably exceeds the budget, so
    // the oldest ones cannot all survive intact.
    const perMessageChars = Math.ceil(RESPONSE_CHAR_BUDGET / 2);
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      role: "assistant" as const,
      createdAt: new Date(`2026-01-01T00:0${i}:00Z`),
      parts: [{ type: "text", text: "a".repeat(perMessageChars) }],
    }));
    seedMessages(rows);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 5,
    });

    // Nothing was silently dropped: every row not fully present in
    // `messages` is accounted for in `truncated` or `omitted`.
    const returnedIds = new Set(result.messages.map((m) => m.id));
    const accountedIds = new Set([...result.truncated, ...result.omitted]);
    for (const row of rows) {
      const fullyPresent = returnedIds.has(row.id) && !accountedIds.has(row.id);
      const shortened = accountedIds.has(row.id);
      expect(fullyPresent || shortened).toBe(true);
    }
    expect(result.omitted.length + result.truncated.length).toBeGreaterThan(0);
    // Nothing reported as omitted also appears in the returned messages.
    for (const id of result.omitted) {
      expect(returnedIds.has(id)).toBe(false);
    }
    // The newest message survives — the whole point of a headless check-in.
    expect(returnedIds.has("m4")).toBe(true);
  });

  test("does not trip the response budget for an ordinary small window", async () => {
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
        parts: [{ type: "text", text: "hi" }],
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:01:00Z"),
        parts: [{ type: "text", text: "hello" }],
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
    });

    expect(result.truncated).toEqual([]);
    expect(result.omitted).toEqual([]);
    expect(result.messages).toHaveLength(2);
  });

  test("messages with malformed or non-array parts return without throwing", async () => {
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
        parts: "not an array or an object with .parts",
      },
      {
        id: "m2",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:01:00Z"),
        parts: null,
      },
      {
        id: "m3",
        role: "assistant",
        createdAt: new Date("2026-01-01T00:02:00Z"),
        parts: { foo: "bar" },
      },
    ]);

    const result = await getMessages(makeCtx({}), {
      sessionId: "session-1",
      chatId: "chat-1",
      limit: 20,
      includeToolTrace: true,
    });

    expect(result.messages).toHaveLength(3);
    for (const message of result.messages) {
      expect(message.text).toBe("");
      expect(message.chars).toBe(0);
      expect(message.capped).toBe(false);
      expect(message.hasToolCalls).toBe(false);
      expect(message.toolTrace).toEqual([]);
    }
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

// --- #1270: open_agents_get_updates: which sessions finished while the client
// was away. A read over `workflowRuns`, never session_events (those fire all
// through a run and would report activity, not completion). ---
describe("getUpdates (#1270)", () => {
  test("reports exactly one change for a batch with one finished and one still-running session, since a timestamp before both started", async () => {
    const { getUpdates } = await toolsModulePromise;
    // A still-running session has NO finished workflow run row (its run has not
    // ended), so it is structurally absent from the query result. The one
    // finished session is the only row.
    getWorkflowRunsFinishedSince.mockImplementation(async () => [
      buildFinishedRunRow({ sessionId: "session-finished" }),
    ]);

    const result = await getUpdates(makeCtx({}), {
      since: "2025-12-31T00:00:00Z",
      limit: 20,
    });

    expect(result.changes).toHaveLength(1);
    expect(result.count).toBe(1);
    expect(result.changes[0]?.sessionId).toBe("session-finished");
    // The still-running session must never surface as a change.
    expect(result.changes.some((c) => c.sessionId === "session-running")).toBe(
      false,
    );
  });

  test("a session that ended on a blocker is distinguishable from one that completed", async () => {
    const { getUpdates } = await toolsModulePromise;
    getWorkflowRunsFinishedSince.mockImplementation(async () => [
      // #1247: awaiting_tool_approval is the vocabulary for a run that ended
      // paused on something this caller must supply — a blocker.
      buildFinishedRunRow({
        sessionId: "session-blocked",
        status: "awaiting_tool_approval",
      }),
      buildFinishedRunRow({ sessionId: "session-done", status: "completed" }),
    ]);

    const result = await getUpdates(makeCtx({}), {
      since: "2025-12-31T00:00:00Z",
      limit: 20,
    });

    const blocked = result.changes.find(
      (c) => c.sessionId === "session-blocked",
    );
    const done = result.changes.find((c) => c.sessionId === "session-done");
    expect(blocked?.lastRunOutcome).toBe("awaiting_tool_approval");
    expect(done?.lastRunOutcome).toBe("completed");
    expect(blocked?.lastRunOutcome).not.toBe(done?.lastRunOutcome);
  });

  test("nothing changed since T returns the explicit no-changes answer, not a bare empty list", async () => {
    const { getUpdates } = await toolsModulePromise;
    getWorkflowRunsFinishedSince.mockImplementation(async () => []);

    const result = await getUpdates(makeCtx({}), {
      since: "2026-01-01T00:00:00Z",
      limit: 20,
    });

    expect(result.changes).toEqual([]);
    expect(result.count).toBe(0);
    // The response is never ambiguous: an explicit, plainly-worded note exists
    // whenever there is nothing to report, so a client can tell "nothing
    // finished" apart from "the query failed".
    expect(result.note).toMatch(/[Nn]o sessions finished/);
    expect(result.note).toContain("2026-01-01T00:00:00Z");
  });

  test("another user's finished run never appears — the query is scoped to the caller", async () => {
    const { getUpdates } = await toolsModulePromise;
    getWorkflowRunsFinishedSince.mockImplementation(async (input: unknown) => {
      const query = input as { userId: string };
      // Simulate the query's own ownership filter: only rows owned by the
      // caller come back. An implementation that hardcoded a userId, dropped
      // the caller scoping, or looked up by sessionId without the user would
      // let a foreign row through here and fail the assertion.
      expect(query.userId).toBe("user-1");
      return [
        buildFinishedRunRow({ sessionId: "session-1", userId: "user-1" }),
      ];
    });

    const result = await getUpdates(makeCtx({}), {
      since: "2026-01-01T00:00:00Z",
      limit: 20,
    });

    expect(getWorkflowRunsFinishedSince).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes.every((c) => c.sessionId === "session-1")).toBe(true);
  });

  test("forwards an optional label so the answer scopes to one batch", async () => {
    const { getUpdates } = await toolsModulePromise;

    await getUpdates(makeCtx({}), {
      since: "2026-01-01T00:00:00Z",
      label: "auth-refactor-2026-08-14",
      limit: 20,
    });

    expect(getWorkflowRunsFinishedSince).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        label: "auth-refactor-2026-08-14",
      }),
    );
  });

  test("returns a cursor (the server's as-of time) and an explicit count alongside the changes", async () => {
    const { getUpdates } = await toolsModulePromise;
    const before = Date.now();
    getWorkflowRunsFinishedSince.mockImplementation(async () => [
      buildFinishedRunRow(),
    ]);

    const result = await getUpdates(makeCtx({}), {
      since: "2026-01-01T00:00:00Z",
      limit: 20,
    });

    // The cursor is a server-side "as of" timestamp, at least as recent as the
    // start of this call — the caller passes it back as `since` next poll.
    const cursorMs = new Date(result.cursor).getTime();
    expect(cursorMs).toBeGreaterThanOrEqual(before);
    expect(Number.isNaN(cursorMs)).toBe(false);
    expect(result.count).toBe(1);
    expect(result.changes).toHaveLength(1);
  });

  test("the returned shape conforms to the advertised outputSchema, including each change's git-automation events", async () => {
    const { getUpdates, sessionReadTools } = await toolsModulePromise;
    const def = sessionReadTools.find(
      (d) => d.name === "open_agents_get_updates",
    );
    if (!def) {
      throw new Error("open_agents_get_updates not registered");
    }

    getWorkflowRunsFinishedSince.mockImplementation(async () => [
      buildFinishedRunRow({
        sessionId: "session-1",
        branch: "d/abc",
        baseBranch: "main",
        prNumber: 7,
        prStatus: "merged",
      }),
    ]);
    // Two sessions' worth of distinct auto-commit / auto-PR outcomes, so the
    // event fields get real (non-null) values in the parse.
    getLatestSessionEventByNames.mockImplementation(
      async ({ eventNames }: { eventNames: readonly string[] }) => {
        if (eventNames.includes("workflow.auto_commit.failed")) {
          return {
            id: "e1",
            sessionId: "session-1",
            eventName: "workflow.auto_commit.failed",
            status: "failed",
            summary: "push rejected",
            createdAt: "2026-01-01T00:04:00.000Z",
          };
        }
        if (eventNames.includes("workflow.auto_pr.succeeded")) {
          return {
            id: "e2",
            sessionId: "session-1",
            eventName: "workflow.auto_pr.succeeded",
            status: "succeeded",
            summary: "PR opened",
            createdAt: "2026-01-01T00:04:30.000Z",
          };
        }
        return null;
      },
    );

    const result = await getUpdates(makeCtx({}), {
      since: "2026-01-01T00:00:00Z",
      limit: 20,
    });

    // Every field the tool returns must be accepted by the schema it
    // advertises, or the SDK rejects every call.
    const parsed = def.outputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.changes[0]?.lastAutoCommitEvent?.status).toBe("failed");
    expect(result.changes[0]?.lastAutoPrEvent?.status).toBe("succeeded");
  });
});

/**
 * Prose is the only part of a tool that a model reads before deciding whether
 * to call it, and it is not typechecked. These pin the two claims that have
 * already drifted from the code once.
 */
describe("session-state descriptions match what the fields actually do", () => {
  test("resumability is described as filing, not as a workspace value", async () => {
    const { sessionReadTools } = await toolsModulePromise;
    const described = sessionReadTools.filter((tool) =>
      tool.description.includes("resumable"),
    );
    expect(described.length).toBeGreaterThan(0);

    for (const tool of described) {
      // `resumable` is `isResumable(state)` — true for every non-archived
      // session, including ready, provisioning, restoring and failed
      // workspaces. Prose tying it to hibernation tells an agent that a ready
      // session cannot be continued, which is the opposite of the truth.
      expect(tool.description).not.toContain("exactly when");
      expect(tool.description).toContain("non-archived");
    }
  });

  test("a ready workspace is described as a claim about right now", async () => {
    const { sessionReadTools } = await toolsModulePromise;
    for (const tool of sessionReadTools) {
      if (!tool.description.includes("`workspace`")) {
        continue;
      }
      expect(tool.description).toContain("right now");
    }
  });

  test("the get_session description tells a client to re-read when a freshly-idle session briefly reports an idle activity with a null lastRunOutcome", async () => {
    // Transient observed 2026-08-14: `activity` comes from the run slot, which
    // clears at turn end, while `lastRunOutcome` is written a moment later by
    // the post-finish path. A client polling "wait until idle, then read the
    // outcome" can catch that window and see idle + null — the same shapes as a
    // session that has never run. The prose must not let a client read that
    // combination as "never ran" without re-reading, or it decides a finished
    // run was never started.
    const { sessionReadTools } = await toolsModulePromise;
    const getSessionDef = sessionReadTools.find(
      (def) => def.name === "open_agents_get_session",
    );
    if (!getSessionDef) {
      throw new Error("open_agents_get_session not registered");
    }
    expect(getSessionDef.description).toContain("`activity`");
    expect(getSessionDef.description).toContain("`lastRunOutcome`");
    expect(getSessionDef.description).toContain("re-read");
    expect(getSessionDef.description).toMatch(/`idle`.+null/);
  });
});
