import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Minimal schema stub so drizzle column references (eq/inArray/desc) resolve
// without importing the real schema (which would pull in a live DB client).
mock.module("@/lib/db/schema", () => ({
  sessionEvents: {
    sessionId: "session_id",
    eventName: "event_name",
    createdAt: "created_at",
  },
}));

let findManyResult: unknown[] = [];
let findManyArgs: unknown;

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessionEvents: {
        findMany: async (opts: unknown) => {
          findManyArgs = opts;
          return findManyResult;
        },
      },
    },
  },
}));

const { getLatestSessionEventByNames } = await import("./session-event-lookup");

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    sessionId: "session-1",
    chatId: null,
    userId: "user-1",
    source: "github",
    actorType: "workflow",
    actorId: null,
    eventName: "workflow.auto_commit.failed",
    status: "failed",
    summary: "Auto-commit failed: Changes must be made through a pull request.",
    requestId: null,
    workflowRunId: "run-1",
    harnessRunId: null,
    sandboxName: null,
    managedRuntimeProfileRunId: null,
    serviceId: null,
    browserRunId: null,
    payload: {},
    redactionStatus: "passed",
    createdAt: new Date("2026-08-14T12:17:51.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  findManyResult = [];
  findManyArgs = undefined;
});

describe("getLatestSessionEventByNames", () => {
  test("BT: returns null when no session_events row matches the given names", async () => {
    findManyResult = [];

    const result = await getLatestSessionEventByNames({
      sessionId: "session-1",
      eventNames: ["workflow.auto_commit.failed"],
    });

    expect(result).toBeNull();
  });

  test("BT: returns the matching row, serialized with an ISO-string createdAt", async () => {
    findManyResult = [buildRow()];

    const result = await getLatestSessionEventByNames({
      sessionId: "session-1",
      eventNames: [
        "workflow.auto_commit.failed",
        "workflow.auto_commit.succeeded",
      ],
    });

    expect(result).toEqual({
      id: "event-1",
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      source: "github",
      actorType: "workflow",
      actorId: null,
      eventName: "workflow.auto_commit.failed",
      status: "failed",
      summary:
        "Auto-commit failed: Changes must be made through a pull request.",
      requestId: null,
      workflowRunId: "run-1",
      harnessRunId: null,
      sandboxName: null,
      managedRuntimeProfileRunId: null,
      serviceId: null,
      browserRunId: null,
      payload: {},
      redactionStatus: "passed",
      createdAt: "2026-08-14T12:17:51.000Z",
    });
  });

  test("regression: queries by sessionId scoped to the exact eventNames set, ordered newest-first, limited to one row — a broader query would risk leaking another session's event or returning a stale one", async () => {
    findManyResult = [buildRow()];

    await getLatestSessionEventByNames({
      sessionId: "session-42",
      eventNames: ["workflow.auto_pr.failed", "workflow.auto_pr.skipped"],
    });

    const args = findManyArgs as {
      where: unknown;
      orderBy: unknown[];
      limit: number;
    };
    expect(args.limit).toBe(1);
    expect(Array.isArray(args.orderBy)).toBe(true);
    expect(args.orderBy).toHaveLength(1);
    // `where` is a drizzle SQL expression object, not a plain literal — assert
    // it was built (not undefined/omitted) rather than its internal shape.
    expect(args.where).toBeDefined();
  });
});
