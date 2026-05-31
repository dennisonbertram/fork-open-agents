/**
 * Security regression tests for the agent API runs surface.
 * Each describe block maps to a specific security finding.
 * Written RED-FIRST: all tests must fail before the fixes are applied.
 */
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared mocks/fixtures
// ---------------------------------------------------------------------------

type SessionEventRow = {
  id: string;
  sessionId: string;
  chatId: string | null;
  workflowRunId: string | null;
  requestId: string | null;
  eventName: string;
  status: string;
  source: string;
  actorType: string;
  summary: string | null;
  sandboxName: string | null;
  managedRuntimeProfileRunId: string | null;
  payload: Record<string, unknown>;
  redactionStatus: "not_required" | "passed" | "failed" | "blocked" | "pending";
  createdAt: Date;
};

function makeEvent(overrides: Partial<SessionEventRow> = {}): SessionEventRow {
  return {
    id: "evt_1",
    sessionId: "session_a",
    chatId: "chat_a",
    workflowRunId: "wf_a",
    requestId: "req_a",
    eventName: "test.event",
    status: "info",
    source: "system",
    actorType: "system",
    summary: "test",
    sandboxName: null,
    managedRuntimeProfileRunId: null,
    payload: { secret: "SHOULD_NOT_LEAK" },
    redactionStatus: "passed",
    createdAt: new Date("2026-05-30T12:00:00.000Z"),
    ...overrides,
  };
}

// Session events store: mutable so each test can configure it
let eventStore: SessionEventRow[] = [];

// Track the WHERE clause passed to findMany so tests can inspect it
let lastFindManyWhere: unknown = undefined;
let lastFindFirstWhere: unknown = undefined;

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessionEvents: {
        findFirst: mock(async (opts: { where: unknown }) => {
          lastFindFirstWhere = opts.where;
          // Return the first event in the store (simulates cursor lookup)
          return eventStore[0] ?? null;
        }),
        findMany: mock(async (opts: {
          where: unknown;
          orderBy: unknown;
          limit: number;
        }) => {
          lastFindManyWhere = opts.where;
          // Return all events; the test verifies the WHERE clause structure
          return [...eventStore];
        }),
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// HIGH-1: Cross-run event leak via client-controlled x-request-id
// ---------------------------------------------------------------------------
describe("HIGH-1: listAgentRunEvents must scope to the run's own sessionId", () => {
  /**
   * Before fix: `listAgentRunEvents` issues an OR across sessionId, chatId,
   * workflowRunId AND requestId. If user 2 passes x-request-id=req_a
   * (belonging to user 1), the query matches on `requestId` and returns
   * user 1's events.
   *
   * After fix: query must be scoped by sessionId ONLY (AND-narrowed by
   * chatId/workflowRunId within that session). The client-supplied requestId
   * must NOT be used as an OR branch for authorization.
   *
   * We verify this by inspecting the drizzle SQL expression passed to the
   * mock — the WHERE clause must NOT contain the spoofed requestId as a
   * top-level OR branch.
   */
  /**
   * Extract string values from drizzle SQL queryChunks.
   * Drizzle queryChunks is an array of SQL fragments; param objects have
   * a `value` property. We iterate shallowly to avoid circular reference issues.
   */
  function extractQueryChunkStrings(chunks: unknown[]): string[] {
    const results: string[] = [];
    for (const chunk of chunks) {
      if (typeof chunk === "string") {
        results.push(chunk);
      } else if (
        chunk !== null &&
        typeof chunk === "object" &&
        "value" in (chunk as Record<string, unknown>)
      ) {
        const v = (chunk as Record<string, unknown>)["value"];
        if (typeof v === "string") results.push(v);
      } else if (
        chunk !== null &&
        typeof chunk === "object" &&
        "queryChunks" in (chunk as Record<string, unknown>)
      ) {
        const inner = (chunk as Record<string, unknown>)[
          "queryChunks"
        ] as unknown[];
        if (Array.isArray(inner)) {
          results.push(...extractQueryChunkStrings(inner));
        }
      }
    }
    return results;
  }

  test("BT-001: WHERE clause must not OR-branch on client-supplied requestId", async () => {
    lastFindManyWhere = undefined;
    eventStore = [];

    const { listAgentRunEvents } = await import("./snapshots");

    await listAgentRunEvents({
      sessionId: "session_user2",
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_a", // attacker-controlled: user-1's requestId
      limit: 100,
    });

    // Inspect the WHERE expression's bound string values.
    // Before fix: "req_a" appears as a value in the OR clause.
    // After fix: "req_a" must NOT appear — requestId is no longer an auth selector.
    const where = lastFindManyWhere as {
      queryChunks: unknown[];
    };
    const values = extractQueryChunkStrings(where.queryChunks);

    // The spoofed requestId must not appear in the WHERE clause values
    expect(values).not.toContain("req_a");

    // The correct sessionId MUST appear in the WHERE clause values
    expect(values).toContain("session_user2");
  });

  test("BT-001b: cursor-validation findFirst must AND with the correct sessionId", async () => {
    lastFindFirstWhere = undefined;
    eventStore = [
      makeEvent({
        id: "cursor_evt",
        sessionId: "session_user1", // different session from requester
        createdAt: new Date("2026-05-30T11:00:00.000Z"),
      }),
    ];

    const { listAgentRunEvents } = await import("./snapshots");

    await listAgentRunEvents({
      sessionId: "session_user2",
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_b",
      after: "cursor_evt", // cursor from different session
      limit: 100,
    });

    // The findFirst for the cursor must include the requester's sessionId.
    const where = lastFindFirstWhere as { queryChunks: unknown[] };
    const values = extractQueryChunkStrings(where.queryChunks);

    // After fix: the cursor lookup is scoped to session_user2
    expect(values).toContain("session_user2");
    // The cursor event id must also appear
    expect(values).toContain("cursor_evt");
  });
});

// ---------------------------------------------------------------------------
// HIGH-2: Payload must be suppressed for non-passed redaction status
// ---------------------------------------------------------------------------
describe("HIGH-2: toApiEventSnapshot must suppress payload unless redactionStatus=passed", () => {
  test("BT-002: event with redactionStatus=pending must not expose raw payload", () => {
    const { toApiEventSnapshot } = require("./snapshots");

    const evt = makeEvent({
      redactionStatus: "pending" as unknown as SessionEventRow["redactionStatus"],
      payload: { secret: "SENSITIVE_DATA" },
    });

    const snapshot = toApiEventSnapshot(evt as unknown as import("@/lib/db/schema").SessionEvent);

    // payload must be absent or scrubbed (null/undefined/{})
    const hasRawPayload =
      snapshot.payload !== null &&
      snapshot.payload !== undefined &&
      typeof snapshot.payload === "object" &&
      Object.keys(snapshot.payload).length > 0 &&
      (snapshot.payload as Record<string, unknown>)["secret"] !== undefined;

    expect(hasRawPayload).toBe(false);
  });

  test("BT-002b: event with redactionStatus=failed must not expose raw payload", () => {
    const { toApiEventSnapshot } = require("./snapshots");

    const evt = makeEvent({
      redactionStatus: "failed",
      payload: { apiKey: "sk-secret-1234" },
    });

    const snapshot = toApiEventSnapshot(evt as unknown as import("@/lib/db/schema").SessionEvent);

    const leaked =
      snapshot.payload !== null &&
      snapshot.payload !== undefined &&
      typeof snapshot.payload === "object" &&
      (snapshot.payload as Record<string, unknown>)["apiKey"] !== undefined;

    expect(leaked).toBe(false);
  });

  test("BT-002c: event with redactionStatus=passed may expose payload", () => {
    const { toApiEventSnapshot } = require("./snapshots");

    const evt = makeEvent({
      redactionStatus: "passed",
      payload: { result: "ok" },
    });

    const snapshot = toApiEventSnapshot(evt as unknown as import("@/lib/db/schema").SessionEvent);

    // When passed, payload IS allowed (it was vetted)
    const hasPayload =
      snapshot.payload !== null &&
      snapshot.payload !== undefined &&
      typeof snapshot.payload === "object" &&
      (snapshot.payload as Record<string, unknown>)["result"] === "ok";

    expect(hasPayload).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HIGH-3: Repository allowlist bypass by omitting repository
// ---------------------------------------------------------------------------
describe("HIGH-3: normalizeRepository must deny no-repo runs for restricted tokens", () => {
  test("BT-003: token restricted to repo X must not allow no-repository run", async () => {
    const { normalizeRepository } = await import("./repositories");

    const result = normalizeRepository(undefined, {
      allowedRepositories: ["acme/widgets"],
    });

    // Before fix: ok=true, repository=null (bypass!)
    // After fix: ok=false with an appropriate error code
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("repository_required");
    }
  });

  test("BT-003b: unrestricted token (null allowedRepositories) may run without repo", async () => {
    const { normalizeRepository } = await import("./repositories");

    const result = normalizeRepository(undefined, {
      allowedRepositories: null,
    });

    // Unrestricted tokens may still omit repository
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repository).toBeNull();
    }
  });
});
