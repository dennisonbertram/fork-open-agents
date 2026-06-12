/**
 * Stall-sweep cutoff Date-interpolation bug — RED / regression tests
 *
 * BUG: findStalledLoopRunCandidates builds a JS Date cutoff and interpolates it
 * directly into a raw SQL template:
 *
 *   sql`COALESCE(...) < ${cutoff}`
 *
 * The postgres v3 driver's Bind() serialiser cannot handle a Date instance as a
 * prepared-statement parameter — it throws TypeError at the Bind() step:
 *
 *   TypeError: The "string" argument must be of type string…
 *   Received an instance of Date
 *   at str (postgres@3.4.9/src/bytes.js:22:27)
 *   at Bind (postgres@3.4.9/src/connection.js:964:16)
 *
 * The stall-sweep endpoint calls this function on every sweep tick, so every
 * sweep 500s before marking any stalled run.
 *
 * This is the same class of bug fixed in four other functions (see
 * d1-coalesce-date-fix.test.ts).  This function was MISSED by that fix.
 *
 * The safe fix: replace ${cutoff} with ${cutoff.toISOString()}::timestamp so
 * the bound parameter is a plain string (which the postgres driver accepts) and
 * the ::timestamp cast tells postgres how to interpret it.  The agentLoopRuns
 * and agentLoopEvents createdAt columns are `timestamp` (without time zone)
 * per schema.ts, so ::timestamp is the correct cast.
 *
 * Test strategy: mock @/lib/db/client and capture the SQL argument passed to
 * the .where() call.  Inspect the Drizzle SQL object's queryChunks (including
 * all nested SQL objects) for Date instances.  A Date instance in any chunk
 * triggers the postgres driver bug; a plain string does not.
 *
 * REG note: the regression test (stall-sweep-cutoff-date-fix.regression.test.ts)
 * mirrors these assertions so a future revert is caught.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── where-capture mock ────────────────────────────────────────────────────────
// We need to capture the SQL expression passed to db.select().from().where()
// so we can inspect its queryChunks for raw Date instances.

let capturedWhereArg: unknown = undefined;

const whereMockSelect = mock((arg: unknown) => {
  capturedWhereArg = arg;
  return Promise.resolve([]);
});

const fromMockSelect = mock((_table: unknown) => ({
  where: whereMockSelect,
}));

const selectMock = mock((_fields?: unknown) => ({
  from: fromMockSelect,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: selectMock,
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
      agentLoops: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopRuns: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopStepRuns: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopEvents: {
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
        delete: mock(() => ({
          where: mock(() => ({ returning: mock(() => []) })),
        })),
        query: {
          agentLoops: { findFirst: mock(async () => null) },
          agentLoopRuns: { findFirst: mock(async () => null) },
          agentLoopStepRuns: { findFirst: mock(async () => null) },
        },
      }),
    ),
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoops: Symbol("agentLoops"),
  agentLoopRuns: Symbol("agentLoopRuns"),
  agentLoopStepRuns: Symbol("agentLoopStepRuns"),
  agentLoopEvents: Symbol("agentLoopEvents"),
}));

const storePromise = import("./store");

function resetMocks() {
  capturedWhereArg = undefined;
  selectMock.mockClear();
  fromMockSelect.mockClear();
  whereMockSelect.mockClear();
}

/**
 * Recursively walks a Drizzle SQL object (or any value) and returns true if any
 * node is a Date instance.
 *
 * The postgres v3 driver throws TypeError when it receives a Date as a prepared-
 * statement bind parameter.  A plain string (even ISO-formatted) does not trigger
 * this error.  Therefore the invariant we assert is: NO Date instance anywhere in
 * the SQL object's parameter graph.
 *
 * Walk strategy:
 *   - Date instance → true (found the bug)
 *   - Array        → recurse into each element
 *   - object with .queryChunks → recurse into chunks (Drizzle SQL node)
 *   - object with .getSQL      → recurse into getSQL().queryChunks (SQL expression)
 *   - anything else            → false
 */
function sqlHasRawDateChunk(obj: unknown, depth = 0): boolean {
  if (depth > 15) return false;
  if (obj instanceof Date) return true;
  if (Array.isArray(obj)) {
    return obj.some((item) => sqlHasRawDateChunk(item, depth + 1));
  }
  if (obj !== null && typeof obj === "object") {
    // Drizzle SQL objects store their chunks here
    const chunks = (obj as Record<string, unknown>).queryChunks;
    if (chunks !== undefined) return sqlHasRawDateChunk(chunks, depth + 1);
    // SQL expressions expose a getSQL() method
    const getSQL = (obj as Record<string, unknown>).getSQL;
    if (typeof getSQL === "function") {
      return sqlHasRawDateChunk((getSQL as () => unknown)(), depth + 1);
    }
  }
  return false;
}

// ── SW-D1-001: findStalledLoopRunCandidates WHERE clause has no Date param ───

describe("SW-D1-001: findStalledLoopRunCandidates — cutoff bound as ISO string, not Date (postgres-safe)", () => {
  beforeEach(resetMocks);

  test("WHERE argument contains NO raw Date instance in any queryChunk", async () => {
    // This test catches the bug: if ${cutoff} (a JS Date) is interpolated
    // directly into the sql`` template, sqlHasRawDateChunk returns true → FAIL.
    // After the fix (${cutoff.toISOString()}::timestamp), only a plain string
    // is bound → sqlHasRawDateChunk returns false → PASS.
    const store = await storePromise;
    await store.findStalledLoopRunCandidates({ thresholdMinutes: 30 });

    // Confirm the where mock was actually called (function reached .where())
    expect(whereMockSelect).toHaveBeenCalledTimes(1);

    const whereArg = capturedWhereArg;
    expect(whereArg).toBeDefined();

    // The critical assertion: no Date instance anywhere in the SQL parameter graph.
    // Fails (RED) when cutoff is a raw Date; passes (GREEN) after toISOString() fix.
    expect(sqlHasRawDateChunk(whereArg)).toBe(false);
  });

  test("WHERE argument is a defined SQL-like object (sanity: where was called)", async () => {
    const store = await storePromise;
    await store.findStalledLoopRunCandidates({ thresholdMinutes: 15 });

    expect(capturedWhereArg).not.toBeNull();
    expect(typeof capturedWhereArg).toBe("object");
  });
});

// ── REG-SW-D1: regression — once fixed, no revert reintroduces Date bind ────

describe("REG-SW-D1: findStalledLoopRunCandidates — cutoff stays postgres-safe (regression)", () => {
  beforeEach(resetMocks);

  test("cutoff WHERE param has no Date instance for any threshold value", async () => {
    // Runs with two different thresholds to ensure the Date is never bound.
    const store = await storePromise;

    await store.findStalledLoopRunCandidates({ thresholdMinutes: 5 });
    const arg5 = capturedWhereArg;
    resetMocks();

    await store.findStalledLoopRunCandidates({ thresholdMinutes: 120 });
    const arg120 = capturedWhereArg;

    expect(sqlHasRawDateChunk(arg5)).toBe(false);
    expect(sqlHasRawDateChunk(arg120)).toBe(false);
  });
});
