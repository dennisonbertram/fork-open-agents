/**
 * D1 COALESCE Date-interpolation bug — RED tests (live-proof D1)
 *
 * BUG: conditionallyTransitionRunStatus, resumeLoopRun, retryCurrentStep, and
 * updateAgentLoopRunStatus all use sql`COALESCE(${agentLoopRuns.startedAt}, ${now})`
 * where `now` is a JavaScript Date.  The postgres v3 driver's Bind() serializer
 * cannot handle a Date instance in a prepared-statement parameter:
 *
 *   TypeError: The "string" argument must be of type string…
 *   Received an instance of Date
 *   at str (postgres@3.4.9/src/bytes.js:22:27)
 *   at Bind (postgres@3.4.9/src/connection.js:964:16)
 *
 * The Workflow SDK retries 3× then raises a FatalError — every run sticks at
 * queued.  The fix is to replace ${now} with the SQL function NOW() so no Date
 * is bound as a parameter.
 *
 * Test strategy (D1 note): mocks capture the raw Drizzle SQL object passed to
 * db.update().set().  We inspect that object's internal queryChunks array —
 * the same array the postgres driver processes.  When the bug is present, one
 * chunk is an ISO Date string (which the driver then coerces to Date, failing).
 * When fixed, queryChunks contains only string literals; the second arg to
 * COALESCE is embedded as `NOW()` text, not a bound parameter.
 *
 * Functions under test:
 *   - conditionallyTransitionRunStatus (line ~1022 in store.ts) [primary D1]
 *   - resumeLoopRun                   (line ~856 in store.ts)
 *   - retryCurrentStep                (line ~981 in store.ts)
 *   - updateAgentLoopRunStatus        (line ~425 in store.ts) [existing F4a gap]
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock ───────────────────────────────────────────────────────────────────
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
  where: mock(() => ({ limit: limitMockLeft })),
}));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

const txFindFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);
const txUpdateSetMock = mock((setVals: unknown) => ({
  where: mock(() => ({
    returning: mock(() => [
      { ...(insertedValues[0] as object), ...(setVals as object) },
    ]),
  })),
}));
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
        // retryCurrentStep (non-queued path) calls tx.select() for MAX(attempt)
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
  // mockReset clears pending mockImplementationOnce queue in addition to call records
  // so leftover one-shot implementations cannot bleed into the next test.
  updateSetMock.mockReset();
  updateSetMock.mockImplementation((setVals: unknown) => {
    updateSetCapture.push(setVals);
    return {
      where: mock(() => ({
        returning: mock(() => [
          { ...(insertedValues[0] as object), ...(setVals as object) },
        ]),
      })),
    };
  });
  deleteMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockReset();
  findFirstMock.mockImplementation(
    async () => (queryResult[0] ?? null) as unknown,
  );
  returningMock.mockReset();
  returningMock.mockImplementation(() => {
    const first = insertedValues[0];
    return first ? [first] : [];
  });
  valuesMock.mockClear();
  onConflictDoNothingMock.mockClear();
  leftJoinMock.mockClear();
  whereMockLeft.mockClear();
  limitMockLeft.mockClear();
  txFindFirstMock.mockReset();
  txFindFirstMock.mockImplementation(
    async () => (queryResult[0] ?? null) as unknown,
  );
  txUpdateMock.mockClear();
  txUpdateSetMock.mockReset();
  txUpdateSetMock.mockImplementation((setVals: unknown) => ({
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  }));
  selectMock.mockReset();
  selectMock.mockImplementation((_fields?: unknown) => ({ from: fromMock }));
  txInsertMock.mockClear();
}

function makeLoopRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "failed",
    definitionSnapshot: { nodes: [], edges: [] },
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

function makeStepRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "step-1",
    loopRunId: "run-1",
    nodeId: "node-1",
    nodeKind: "agent_step",
    attempt: 1,
    status: "failed",
    input: null,
    output: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Inspects a Drizzle SQL object's queryChunks for Date instances.
 *
 * Drizzle's sql`` tagged template stores interpolated values in `queryChunks`.
 * For sql`COALESCE(col, ${now})` where `now` is a JS Date, the chunk at index 1
 * will be an ISO date string (already serialized from the Date object before
 * the postgres driver sees it).  The postgres driver's Bind() then tries to call
 * str() on it which fails because str() requires a Buffer/string but receives a
 * Date after Drizzle's type-mapping applies.
 *
 * For sql`COALESCE(col, NOW())`, there is only ONE chunk (a string literal
 * containing the full SQL text), with no bound parameters.
 *
 * Returns true if any chunk looks like a Date (is a Date instance or ISO string).
 */
function sqlHasDateChunk(sqlObj: unknown): boolean {
  const chunks = (sqlObj as Record<string, unknown>)?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  for (const chunk of chunks) {
    // A bound Date param appears as a Date instance or ISO string in queryChunks
    if (chunk instanceof Date) return true;
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
 * Checks that the SQL object's queryChunks contain "NOW()" as a text literal.
 */
function sqlContainsNowLiteral(sqlObj: unknown): boolean {
  const chunks = (sqlObj as Record<string, unknown>)?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  for (const chunk of chunks) {
    if (typeof chunk === "string" && chunk.includes("NOW()")) return true;
    // Drizzle wraps string chunks in {value: string[]} objects
    const val = (chunk as Record<string, unknown>)?.value;
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string" && v.includes("NOW()")) return true;
      }
    }
  }
  return false;
}

// ── D1-001: conditionallyTransitionRunStatus (the primary live-proof defect) ──

describe("D1-001: conditionallyTransitionRunStatus — COALESCE uses NOW() not a Date param", () => {
  beforeEach(resetMocks);

  test("toStatus=running: startedAt SQL object contains NOW() literal, not a Date chunk", async () => {
    // D1: before the fix, the COALESCE bound a JS Date as a parameter.
    // After the fix, it must use the SQL NOW() function with no Date parameter.
    const store = await storePromise;
    await store.conditionallyTransitionRunStatus({
      runId: "run-1",
      toStatus: "running",
      fromStatuses: ["queued"],
    });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    expect(setCall?.startedAt).toBeDefined();

    // Must be a SQL expression object, not a raw Date
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);

    // Must NOT bind a Date parameter (the bug: postgres driver throws on Date bind)
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);

    // Must contain the NOW() SQL function literal
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });

  test("toStatus=stalled (terminal): startedAt absent, finishedAt is a Date (terminal writes are fine)", async () => {
    const store = await storePromise;
    await store.conditionallyTransitionRunStatus({
      runId: "run-1",
      toStatus: "stalled",
      fromStatuses: ["queued", "running"],
    });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    // startedAt not set for non-running transitions
    expect(setCall?.startedAt).toBeUndefined();
    // finishedAt is a Date (terminal writes use JS Date — postgres can handle these via Drizzle's typed column setter)
    expect(setCall?.finishedAt).toBeInstanceOf(Date);
  });
});

// ── D1-002: resumeLoopRun COALESCE ────────────────────────────────────────────

describe("D1-002: resumeLoopRun — COALESCE startedAt uses NOW() not a Date param", () => {
  beforeEach(resetMocks);

  test("resumeLoopRun: startedAt SQL object contains NOW() literal, not a Date chunk", async () => {
    // resumeLoopRun always transitions to "running" with a COALESCE startedAt.
    // The fix must eliminate the JS Date bind parameter.
    returningMock.mockImplementationOnce(() => [
      makeLoopRun({ status: "running" }),
    ]);
    queryResult = [makeLoopRun({ status: "paused" })];

    const store = await storePromise;
    await store.resumeLoopRun("run-1", "user-1");

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    expect(setCall?.startedAt).toBeDefined();
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });
});

// ── D1-003: retryCurrentStep COALESCE ────────────────────────────────────────

describe("D1-003: retryCurrentStep — COALESCE startedAt uses NOW() not a Date param", () => {
  beforeEach(resetMocks);

  test("retryCurrentStep: startedAt SQL object contains NOW() literal, not a Date chunk", async () => {
    // retryCurrentStep runs inside db.transaction(). It:
    //   1. tx.query.agentLoopRuns.findFirst  → the run (status "failed")
    //   2. tx.query.agentLoopStepRuns.findFirst → the failed step (status "failed")
    //      → takes the non-queued path (creates a new attempt)
    //   3. tx.select({maxAttempt}).from(...).where(...) → MAX(attempt) = 1
    //   4. tx.insert(agentLoopStepRuns).values(...).returning() → new step
    //   5. tx.update(agentLoopRuns).set({status:"running", startedAt:COALESCE}).where().returning()
    //
    // The fix must ensure step 5's startedAt contains NOW() with no Date bind.
    const run = makeLoopRun({ status: "failed" });
    const failedStep = makeStepRun({ status: "failed" });
    const newStep = makeStepRun({ id: "step-2", attempt: 2, status: "queued" });

    // Wire tx.query.agentLoopRuns.findFirst → run (first call)
    // Wire tx.query.agentLoopStepRuns.findFirst → failedStep (second call)
    // Both tables share txFindFirstMock; use sequential one-shot responses.
    txFindFirstMock.mockResolvedValueOnce(run);
    txFindFirstMock.mockResolvedValueOnce(failedStep);

    // tx.select({maxAttempt}).from(...).where(...) for MAX(attempt)
    // selectMock is added to the tx object so this one-shot override applies.
    const whereForSelect = mock(() =>
      Promise.resolve([{ maxAttempt: 1 }]),
    ) as unknown as typeof whereMockLeft;
    const fromForSelect = mock(() => ({
      where: whereForSelect,
    })) as unknown as typeof fromMock;
    (
      selectMock.mockImplementationOnce as (
        impl: (_fields?: unknown) => { from: typeof fromForSelect },
      ) => typeof selectMock
    )((_fields?: unknown) => ({
      from: fromForSelect,
    }));

    // tx.insert().values().returning() → new step run
    returningMock.mockImplementationOnce(() => [newStep]);

    // tx.update().set().where().returning() for the COALESCE "running" transition.
    // txUpdateSetMock captures setVals and returns a matching row so the code
    // doesn't throw RunControlError("illegal_transition").
    txUpdateSetMock.mockImplementationOnce((setVals: unknown) => {
      updateSetCapture.push(setVals);
      return {
        where: mock(() => ({
          returning: mock(() => [
            { ...(run as object), ...(setVals as object) },
          ]),
        })),
      };
    });

    const store = await storePromise;
    await store.retryCurrentStep({ runId: "run-1", userId: "user-1" });

    // Find the update that sets status=running (has startedAt — the COALESCE write)
    const runningSetCall = (
      updateSetCapture as Array<Record<string, unknown>>
    ).find((c) => c.status === "running");
    expect(runningSetCall).toBeDefined();
    expect(runningSetCall?.startedAt).toBeDefined();
    expect(runningSetCall?.startedAt).not.toBeInstanceOf(Date);
    expect(sqlHasDateChunk(runningSetCall?.startedAt)).toBe(false);
    expect(sqlContainsNowLiteral(runningSetCall?.startedAt)).toBe(true);
  });
});

// ── D1-004: updateAgentLoopRunStatus COALESCE (deeper check than F4a) ─────────

describe("D1-004: updateAgentLoopRunStatus — COALESCE startedAt uses NOW() not a Date param", () => {
  beforeEach(resetMocks);

  test("status=running: SQL object contains NOW() literal with no Date parameter", async () => {
    // REGRESSION-F4a already checks this is a SQL object (not a Date).
    // This test adds the deeper check: the SQL object must NOT bind a Date.
    // Catches the bug where sql`COALESCE(..., ${now})` creates a SQL object
    // that still carries a Date as a bound parameter in queryChunks.
    const store = await storePromise;
    await store.updateAgentLoopRunStatus({ runId: "run-1", status: "running" });

    const setCall = updateSetCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    expect(setCall?.startedAt).toBeDefined();
    expect(setCall?.startedAt).not.toBeInstanceOf(Date);

    // D1 deeper check: no Date parameter bound (what the postgres driver fails on)
    expect(sqlHasDateChunk(setCall?.startedAt)).toBe(false);
    // And it must use the NOW() function
    expect(sqlContainsNowLiteral(setCall?.startedAt)).toBe(true);
  });
});
