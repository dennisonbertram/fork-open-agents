/**
 * listStaleBackgroundAgentRuns cutoff Date-interpolation bug — RED / regression tests
 *
 * BUG (issue #758, ticket #764): listStaleBackgroundAgentRuns builds a JS Date
 * cutoff (`params.staleBefore`) and interpolates it directly into a raw SQL
 * template:
 *
 *   sql`${backgroundAgentRuns.updatedAt} < ${params.staleBefore}`
 *
 * The postgres v3 driver's Bind() serialiser cannot handle a Date instance as
 * a prepared-statement parameter — it throws TypeError at the Bind() step.
 * dispatchScheduledBackgroundAgents (dispatcher.ts:653-657) calls this
 * function unconditionally at the top of every cron tick, so
 * POST /api/background-agents/cron 500s before any schedule dispatch runs.
 *
 * This is the same class of bug already fixed in agent-loops/store.ts (see
 * d1-coalesce-date-fix.test.ts and stall-sweep-cutoff-date-fix.test.ts in
 * ../agent-loops). This function is the background-agents-side sibling that
 * was missed.
 *
 * The safe fix: replace `${params.staleBefore}` with
 * `${params.staleBefore.toISOString()}::timestamp` so the bound parameter is
 * a plain string (accepted by the postgres driver) and the ::timestamp cast
 * tells postgres how to interpret it. backgroundAgentRuns.updatedAt is a
 * `timestamp` column per schema.ts, so ::timestamp is the correct cast.
 *
 * Test strategy: mock @/lib/db/client and capture the `where` argument passed
 * to db.query.backgroundAgentRuns.findMany({ where, ... }). Inspect the
 * Drizzle SQL object's queryChunks (including nested SQL objects) for Date
 * instances. A Date instance anywhere in the graph triggers the postgres
 * driver bug; a plain string does not. Uses the REAL @/lib/db/schema module
 * (pure pgTable definitions, no DB connection) so `and`/`inArray`/`sql` build
 * real column references.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── findMany-capture mock ────────────────────────────────────────────────────

let capturedFindManyArgs: { where?: unknown } | undefined;

const findManyMock = mock(async (args?: { where?: unknown }) => {
  capturedFindManyArgs = args;
  return [];
});

mock.module("@/lib/db/client", () => ({
  db: {
    select: mock(() => ({ from: mock(() => ({ where: mock(() => []) })) })),
    insert: mock(() => ({
      values: mock(() => ({ returning: mock(() => []) })),
    })),
    update: mock(() => ({
      set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })),
    })),
    delete: mock(() => ({
      where: mock(() => ({ returning: mock(() => []) })),
    })),
    query: {
      backgroundAgents: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      backgroundAgentTriggers: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      backgroundAgentRuns: {
        findMany: findManyMock,
        findFirst: mock(async () => null),
      },
      backgroundAgentEvents: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      backgroundAgentOutputs: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: mock(() => ({
          values: mock(() => ({ returning: mock(() => []) })),
        })),
        update: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({ returning: mock(() => []) })),
          })),
        })),
      }),
    ),
  },
}));

const storePromise = import("./store");

function resetMocks() {
  capturedFindManyArgs = undefined;
  findManyMock.mockClear();
}

/**
 * Recursively walks a Drizzle SQL object (or any value) and returns true if
 * any node is a Date instance. See stall-sweep-cutoff-date-fix.test.ts for
 * the original of this helper (duplicated here to keep this test
 * self-contained and independently runnable).
 */
function sqlHasRawDateChunk(obj: unknown, depth = 0): boolean {
  if (depth > 15) {
    return false;
  }
  if (obj instanceof Date) {
    return true;
  }
  if (Array.isArray(obj)) {
    return obj.some((item) => sqlHasRawDateChunk(item, depth + 1));
  }
  if (obj !== null && typeof obj === "object") {
    const chunks = (obj as Record<string, unknown>).queryChunks;
    if (chunks !== undefined) {
      return sqlHasRawDateChunk(chunks, depth + 1);
    }
    const getSQL = (obj as Record<string, unknown>).getSQL;
    if (typeof getSQL === "function") {
      return sqlHasRawDateChunk((getSQL as () => unknown)(), depth + 1);
    }
  }
  return false;
}

// ── SW-D1-005: listStaleBackgroundAgentRuns WHERE clause has no Date param ──

describe("SW-D1-005: listStaleBackgroundAgentRuns — cutoff bound as ISO string, not Date (postgres-safe)", () => {
  beforeEach(resetMocks);

  test("WHERE argument contains NO raw Date instance in any queryChunk", async () => {
    // This test catches the bug: if `params.staleBefore` (a JS Date) is
    // interpolated directly into the sql`` template, sqlHasRawDateChunk
    // returns true → FAIL. After the fix
    // (${params.staleBefore.toISOString()}::timestamp), only a plain string
    // is bound → sqlHasRawDateChunk returns false → PASS.
    const store = await storePromise;
    await store.listStaleBackgroundAgentRuns({ staleBefore: new Date() });

    expect(findManyMock).toHaveBeenCalledTimes(1);

    const whereArg = capturedFindManyArgs?.where;
    expect(whereArg).toBeDefined();

    expect(sqlHasRawDateChunk(whereArg)).toBe(false);
  });

  test("WHERE argument is a defined SQL-like object (sanity: findMany was called)", async () => {
    const store = await storePromise;
    await store.listStaleBackgroundAgentRuns({ staleBefore: new Date() });

    expect(capturedFindManyArgs).not.toBeUndefined();
    expect(typeof capturedFindManyArgs?.where).toBe("object");
  });
});

// ── REG-SW-D1-005: regression — once fixed, no revert reintroduces Date bind ─

describe("REG-SW-D1-005: listStaleBackgroundAgentRuns — cutoff stays postgres-safe (regression)", () => {
  beforeEach(resetMocks);

  test("cutoff WHERE param has no Date instance for multiple staleBefore values", async () => {
    const store = await storePromise;

    await store.listStaleBackgroundAgentRuns({
      staleBefore: new Date("2026-01-01T00:00:00.000Z"),
    });
    const arg1 = capturedFindManyArgs?.where;
    resetMocks();

    await store.listStaleBackgroundAgentRuns({
      staleBefore: new Date("2026-07-02T12:34:56.000Z"),
    });
    const arg2 = capturedFindManyArgs?.where;

    expect(sqlHasRawDateChunk(arg1)).toBe(false);
    expect(sqlHasRawDateChunk(arg2)).toBe(false);
  });
});
