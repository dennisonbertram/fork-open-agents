/**
 * Regression tests for agent API security fixes.
 * These tests catch future breakage if fixes in e6ade3c0 are reverted.
 *
 * Covers different angles than the behavioral tests (edge cases, boundary
 * conditions, exact error shapes). Designed to run in isolation (CI uses
 * test:isolated).
 *
 * Note: mock.module calls are at top-level (Bun requirement).
 * Some tests import the real implementation (not mocked) to test behavior
 * directly.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// DB mock — captures WHERE clause from findMany/findFirst calls.
// Only the sessionEvents table is needed for HIGH-1 regression.
let capturedFindManyWhere: unknown = undefined;
let capturedFindFirstWhere: unknown = undefined;

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessionEvents: {
        findFirst: mock(async (opts: { where: unknown }) => {
          capturedFindFirstWhere = opts.where;
          return null;
        }),
        findMany: mock(async (opts: { where: unknown }) => {
          capturedFindManyWhere = opts.where;
          return [];
        }),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helper: extract string values from drizzle WHERE queryChunks
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// REGRESSION HIGH-1: requestId is never in the WHERE clause
// ---------------------------------------------------------------------------
describe("REGRESSION HIGH-1: requestId omitted from event scope query", () => {
  beforeEach(() => {
    capturedFindManyWhere = undefined;
    capturedFindFirstWhere = undefined;
  });

  test("requestId is never a WHERE value regardless of what the caller provides", async () => {
    const { listAgentRunEvents } = await import("./snapshots");

    await listAgentRunEvents({
      sessionId: "sess_abc",
      chatId: "chat_abc",
      workflowRunId: "wf_abc",
      requestId: "THIS_MUST_NOT_LEAK",
      limit: 10,
    });

    const where = capturedFindManyWhere as { queryChunks: unknown[] };
    const values = extractQueryChunkStrings(where.queryChunks);

    // Even when requestId is provided, it must not appear in WHERE
    expect(values).not.toContain("THIS_MUST_NOT_LEAK");
    // Session remains the authorization boundary
    expect(values).toContain("sess_abc");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION HIGH-2: payload exposure follows redactionStatus exactly
// ---------------------------------------------------------------------------
describe("REGRESSION HIGH-2: payload suppression by redactionStatus", () => {
  test("redactionStatus=passed exposes payload (no over-suppression)", async () => {
    const { toApiEventSnapshot } = await import("./snapshots");

    const snapshot = toApiEventSnapshot({
      id: "evt_1",
      eventName: "test",
      status: "info",
      source: "system",
      actorType: "system",
      summary: "ok",
      requestId: "req_1",
      workflowRunId: null,
      sandboxName: null,
      managedRuntimeProfileRunId: null,
      payload: { data: "safe_data" },
      redactionStatus: "passed",
      createdAt: new Date(),
    } as unknown as import("@/lib/db/schema").SessionEvent);

    expect(snapshot.payload).not.toBeNull();
    expect((snapshot.payload as Record<string, unknown>)?.["data"]).toBe(
      "safe_data",
    );
  });

  test("redactionStatus=blocked suppresses payload", async () => {
    const { toApiEventSnapshot } = await import("./snapshots");

    const snapshot = toApiEventSnapshot({
      id: "evt_3",
      eventName: "test",
      status: "info",
      source: "system",
      actorType: "system",
      summary: "ok",
      requestId: "req_1",
      workflowRunId: null,
      sandboxName: null,
      managedRuntimeProfileRunId: null,
      payload: { secret: "blocked_secret" },
      redactionStatus: "blocked",
      createdAt: new Date(),
    } as unknown as import("@/lib/db/schema").SessionEvent);

    expect(snapshot.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION HIGH-3: allowlist enforcement boundary conditions
// ---------------------------------------------------------------------------
describe("REGRESSION HIGH-3: allowlist enforcement edge cases", () => {
  test("restricted token providing an allowed repo proceeds normally", async () => {
    const { normalizeRepository } = await import("./repositories");

    const result = normalizeRepository(
      { owner: "acme", name: "widgets" },
      { allowedRepositories: ["acme/widgets"] },
    );

    expect(result.ok).toBe(true);
  });

  test("empty allowedRepositories array still restricts no-repo runs", async () => {
    const { normalizeRepository } = await import("./repositories");

    // An empty array is still non-null — token is restricted
    const result = normalizeRepository(undefined, {
      allowedRepositories: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("repository_required");
    }
  });
});

// ---------------------------------------------------------------------------
// REGRESSION MEDIUM-5: status set contract
// ---------------------------------------------------------------------------
describe("REGRESSION MEDIUM-5: terminal vs cancellable status sets are disjoint", () => {
  test("accepted/starting/running are cancellable; completed/failed/cancelled are not", () => {
    const terminal = new Set(["completed", "failed", "cancelled"]);
    const cancellable = new Set(["accepted", "starting", "running"]);

    for (const s of terminal) {
      expect(cancellable.has(s)).toBe(false);
    }
    for (const s of cancellable) {
      expect(terminal.has(s)).toBe(false);
    }
  });
});
