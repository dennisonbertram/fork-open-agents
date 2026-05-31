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
let agentApiRunStore: Record<
  string,
  {
    id: string;
    userId: string;
    tokenId: string;
    status: string;
    sessionId: string | null;
    chatId: string | null;
    workflowRunId: string | null;
    requestId: string | null;
    finishedAt: Date | null;
    failureKind: string | null;
    failureMessage: string | null;
    failureRetryable: boolean | null;
  }
> = {};

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessionEvents: {
        findFirst: mock(async (opts: { where: unknown }) => {
          // Simple: return the first event matching by id (for "after" cursor)
          return eventStore[0] ?? null;
        }),
        findMany: mock(async (opts: {
          where: unknown;
          orderBy: unknown;
          limit: number;
        }) => {
          // We intentionally return ALL events to prove the scope bug is real
          // (before fix) or filtered (after fix)
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
   * After fix: query should be scoped by sessionId only (AND-narrowed by
   * chatId/workflowRunId within that session). The client-supplied requestId
   * must NOT be used as an OR branch for authorization.
   */
  test("BT-001: user-2 cannot read user-1 events by spoofing user-1 x-request-id", async () => {
    // user-1's event with request-id "req_a"
    const user1Event = makeEvent({
      id: "evt_user1",
      sessionId: "session_user1",
      chatId: "chat_user1",
      workflowRunId: "wf_user1",
      requestId: "req_a", // <-- this is user-1's requestId
    });
    // user-2's event in a different session
    const user2Event = makeEvent({
      id: "evt_user2",
      sessionId: "session_user2",
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_b",
    });
    eventStore = [user1Event, user2Event];

    const { listAgentRunEvents } = await import("./snapshots");

    // user-2 calls listAgentRunEvents for their own run (session_user2),
    // but passes req_a as the requestId from x-request-id header.
    const events = await listAgentRunEvents({
      sessionId: "session_user2", // user-2's session
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_a", // <-- attacker-controlled: user-1's requestId
      limit: 100,
    });

    const returnedIds = events.map((e) => e.id);

    // MUST NOT return user-1's event
    expect(returnedIds).not.toContain("evt_user1");
    // MAY return user-2's event (within scope)
    // (exact inclusion depends on mock; what matters is no cross-tenant leak)
  });

  test("BT-001b: after cursor must belong to the same session before use", async () => {
    // Event in session_user1 - used as cursor by attacker in session_user2
    const cursorEvent = makeEvent({
      id: "cursor_evt",
      sessionId: "session_user1",
      chatId: "chat_user1",
      workflowRunId: "wf_user1",
      requestId: "req_a",
      createdAt: new Date("2026-05-30T11:00:00.000Z"),
    });
    const user2Event = makeEvent({
      id: "evt_user2",
      sessionId: "session_user2",
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_b",
      createdAt: new Date("2026-05-30T12:00:00.000Z"),
    });
    eventStore = [cursorEvent, user2Event];

    const { listAgentRunEvents } = await import("./snapshots");

    // Supply after=cursor_evt (owned by user1) while scoping to user2's session
    // The fix should reject/ignore the cursor because it belongs to a different session
    const events = await listAgentRunEvents({
      sessionId: "session_user2",
      chatId: "chat_user2",
      workflowRunId: "wf_user2",
      requestId: "req_b",
      after: "cursor_evt", // cursor from different session/user
      limit: 100,
    });

    // Must not contain user-1's cursor event in results
    const returnedIds = events.map((e) => e.id);
    expect(returnedIds).not.toContain("cursor_evt");
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
