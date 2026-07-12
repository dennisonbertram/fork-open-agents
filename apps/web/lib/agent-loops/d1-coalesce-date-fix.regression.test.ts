/**
 * D1 COALESCE Date-interpolation — regression tests (live-proof D1)
 *
 * These tests would fail if the fix in 6aeb6abb is reverted.
 *
 * The bug: four functions in store.ts used sql`COALESCE(col, ${now})` where
 * `now` was a JS Date.  The postgres v3 driver cannot bind a Date instance as
 * a prepared-statement parameter — it throws TypeError at the Bind() step.
 * The Workflow SDK retried 3× then raised FatalError; every live run stuck at
 * queued.
 *
 * Regression scenario: if any future change reintroduces `${now}` (a Date) in
 * a COALESCE sql template, these tests catch it by:
 *   1. Asserting the SQL object's queryChunks contain NO Date-like chunk.
 *   2. Asserting the SQL text contains NOW() as a pure SQL literal.
 *   3. Covering all four functions so a partial revert is caught.
 *
 * These tests complement REGRESSION-F4a (which checks the SQL object is not a
 * raw Date) by adding the deeper invariant: the SQL object itself must not
 * carry a Date in its parameter list.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock (same pattern as store.regression.test.ts) ───────────────────────
let insertedValues: unknown[] = [];
let queryResult: unknown[] = [];
const updateSetCapture: unknown[] = [];

const returningMock = mock(() => {
  const first = insertedValues[0];
  return first ? [first] : [];
});

const onConflictDoNothingMock = mock((_opts?: unknown) => ({
  returning: returningMock,
}));

const valuesMock = mock((vals: unknown) => {
  insertedValues = Array.isArray(vals) ? vals : [vals];
  return {
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
  };
});

const insertMock = mock((_table: unknown) => ({ values: valuesMock }));

const updateSetMock = mock((setVals: unknown) => {
  updateSetCapture.push(setVals);
  return {
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  };
});

const updateMock = mock((_table: unknown) => ({
  set: updateSetMock,
}));

const deleteMock = mock((_table: unknown) => ({
  where: mock(() => ({ returning: mock(() => [{ id: "loop-1" }]) })),
}));

const findManyMock = mock(async () => queryResult as unknown[]);
const findFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);

const limitMockLeft = mock(() => Promise.resolve([queryResult[0] ?? null]));
const whereMockLeft = mock(() => ({ limit: limitMockLeft }));
const leftJoinMock = mock(() => ({ where: whereMockLeft }));
const fromMock = mock(() => ({
  leftJoin: leftJoinMock,
  where: mock(() => ({
    limit: limitMockLeft,
    for: mock(() => ({ limit: limitMockLeft })),
  })),
}));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

const txFindFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);
const txUpdateSetMock = mock((setVals: unknown) => {
  updateSetCapture.push(setVals);
  return {
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  };
});
const txUpdateMock = mock((_table: unknown) => ({
  set: txUpdateSetMock,
}));
const txInsertMock = mock((_table: unknown) => ({ values: valuesMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
    query: {
      agentLoops: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopRuns: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopStepRuns: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopEvents: { findMany: findManyMock, findFirst: findFirstMock },
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: txInsertMock,
        update: txUpdateMock,
        delete: deleteMock,
        select: selectMock,
        query: {
          agentLoops: { findFirst: txFindFirstMock },
          agentLoopRuns: { findFirst: txFindFirstMock },
          agentLoopStepRuns: { findFirst: txFindFirstMock },
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
  agentLoopWatchdogRuns: Symbol("agentLoopWatchdogRuns"),
}));

const storePromise = import("./store");

function resetMocks() {
  insertedValues = [];
  queryResult = [];
  updateSetCapture.length = 0;
  insertMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  deleteMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockClear();
  returningMock.mockClear();
  valuesMock.mockClear();
  onConflictDoNothingMock.mockClear();
  leftJoinMock.mockClear();
  whereMockLeft.mockClear();
  limitMockLeft.mockClear();
  txFindFirstMock.mockClear();
  txUpdateMock.mockClear();
  txUpdateSetMock.mockClear();
  txInsertMock.mockClear();
}

function makeLoopRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "failed",
    definitionSnapshot: { nodes: [], edges: [] },
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: "node-1",
    currentStepRunId: "step-1",
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: "idem-1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Returns true if the Drizzle SQL object's queryChunks contain any Date-like
 * value that would be passed to the postgres driver as a bind parameter.
 *
 * The postgres v3 driver calls str() on bind parameters which requires
 * string/Buffer/ArrayBuffer.  A Date instance causes TypeError; an ISO date
 * string may survive but only when properly cast (::timestamptz).
 */
function sqlHasDateChunk(sqlObj: unknown): boolean {
  const chunks = (sqlObj as Record<string, unknown>)?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  for (const chunk of chunks) {
    if (chunk instanceof Date) return true;
    // ISO date string literal (not inside a {value:[...]} wrapper) = bound param
    if (
      typeof chunk === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(chunk)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if any queryChunk (or nested {value:[...]} chunk) contains
 * the SQL text "NOW()".
 */
function sqlContainsNowLiteral(sqlObj: unknown): boolean {
  const chunks = (sqlObj as Record<string, unknown>)?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  for (const chunk of chunks) {
    if (typeof chunk === "string" && chunk.includes("NOW()")) return true;
    const val = (chunk as Record<string, unknown>)?.value;
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string" && v.includes("NOW()")) return true;
      }
    }
  }
  return false;
}

// ── REG-D1-A: conditionallyTransitionRunStatus COALESCE regression ─────────

describe("REG-D1-A: conditionallyTransitionRunStatus COALESCE — no Date bind (live-proof D1 regression)", () => {
  beforeEach(resetMocks);

  test("toStatus=running startedAt COALESCE has no Date parameter in queryChunks", async () => {
    // If reverted to sql`COALESCE(..., ${now})`, sqlHasDateChunk returns true → test fails.
    const store = await storePromise;
    await store.conditionallyTransitionRunStatus({
      runId: "run-1",
      toStatus: "running",
      fromStatuses: ["queued"],
    });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall?.startedAt).toBeDefined();
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });

  test("toStatus=stalled terminal write: finishedAt is a plain Date, startedAt absent", async () => {
    // Ensures we didn't accidentally remove finishedAt=now for terminal statuses.
    const store = await storePromise;
    await store.conditionallyTransitionRunStatus({
      runId: "run-1",
      toStatus: "stalled",
      fromStatuses: ["queued", "running"],
    });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall?.startedAt).toBeUndefined();
    expect(setCall?.finishedAt).toBeInstanceOf(Date);
  });
});

// ── REG-D1-B: updateAgentLoopRunStatus COALESCE regression ────────────────

describe("REG-D1-B: updateAgentLoopRunStatus COALESCE — no Date bind (live-proof D1 regression)", () => {
  beforeEach(resetMocks);

  test("status=running startedAt COALESCE has no Date parameter in queryChunks", async () => {
    const store = await storePromise;
    await store.updateAgentLoopRunStatus({ runId: "run-1", status: "running" });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall?.startedAt).toBeDefined();
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });
});

// ── REG-D1-C: resumeLoopRun COALESCE regression ───────────────────────────

describe("REG-D1-C: resumeLoopRun COALESCE — no Date bind (live-proof D1 regression)", () => {
  beforeEach(resetMocks);

  test("resumeLoopRun startedAt COALESCE has no Date parameter in queryChunks", async () => {
    returningMock.mockImplementationOnce(() => [
      makeLoopRun({ status: "running" }),
    ]);
    queryResult = [makeLoopRun({ status: "paused" })];

    const store = await storePromise;
    await store.resumeLoopRun("run-1", "user-1");

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall?.startedAt).toBeDefined();
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });
});

// ── REG-D1-D: All four COALESCE sites can coexist without Date param ──────

describe("REG-D1-D: All COALESCE sites produce NOW()-literal SQL (exhaustive regression)", () => {
  beforeEach(resetMocks);

  test("none of the startedAt values across multiple calls carries a Date chunk", async () => {
    // Calls all four COALESCE-writing paths in sequence. If any is reverted,
    // sqlHasDateChunk returns true for that call's setCall.
    const store = await storePromise;

    // 1. updateAgentLoopRunStatus(running)
    await store.updateAgentLoopRunStatus({ runId: "r1", status: "running" });
    resetMocks();

    // 2. conditionallyTransitionRunStatus(running)
    await store.conditionallyTransitionRunStatus({
      runId: "r2",
      toStatus: "running",
      fromStatuses: ["queued"],
    });
    resetMocks();

    // 3. resumeLoopRun
    returningMock.mockImplementationOnce(() => [
      makeLoopRun({ id: "r3", status: "running" }),
    ]);
    queryResult = [makeLoopRun({ id: "r3", status: "paused" })];
    await store.resumeLoopRun("r3", "user-1");

    // All captured set calls must be free of Date parameters
    for (const setCall of updateSetCapture as Array<Record<string, unknown>>) {
      if (setCall.startedAt !== undefined) {
        expect(setCall.startedAt).not.toBeInstanceOf(Date);
        expect(sqlHasDateChunk(setCall.startedAt)).toBe(false);
        expect(sqlContainsNowLiteral(setCall.startedAt)).toBe(true);
      }
    }
  });
});
