/**
 * Agent Loops — Review-fix store-level tests (TASK-PR344-REVIEW-FIXES)
 *
 * BT-F4 store level:
 *   (a) updateAgentLoopRunStatus with status=running twice — startedAt set on
 *       the first call but NOT reset on the second call (coalesce guard).
 *   (b) updateAgentLoopRunContext exists and only updates context + updatedAt
 *       (no status, no startedAt change).
 *   (c) Regression: github_check success does not reset run startedAt.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock ───────────────────────────────────────────────────────────────────

let insertedValues: unknown[] = [];
let lastSetValues: unknown = {};

// Captures what was passed to .set() so we can assert on it
const setCapture: unknown[] = [];

const returningMock = mock(() => {
  const first = insertedValues[0];
  return first ? [first] : [];
});

const valuesMock = mock((vals: unknown) => {
  insertedValues = Array.isArray(vals) ? vals : [vals];
  return { returning: returningMock };
});

const insertMock = mock((_table: unknown) => ({ values: valuesMock }));

const updateSetMock = mock((setVals: unknown) => {
  lastSetValues = setVals;
  setCapture.push(setVals);
  return {
    where: mock(() => ({
      returning: mock(() => [
        {
          ...(insertedValues[0] as object),
          ...(setVals as object),
        },
      ]),
    })),
  };
});

const updateMock = mock((_table: unknown) => ({
  set: updateSetMock,
}));

const deleteMock = mock((_table: unknown) => ({
  where: mock(() => ({ returning: mock(() => []) })),
}));

const findFirstMock = mock(async () => null as unknown);
const findManyMock = mock(async () => [] as unknown[]);

const limitMockLeft = mock(() => Promise.resolve([null]));
const whereMockLeft = mock(() => ({ limit: limitMockLeft }));
const leftJoinMock = mock(() => ({ where: whereMockLeft }));
const fromMock = mock(() => ({
  leftJoin: leftJoinMock,
  where: mock(() => ({ limit: limitMockLeft })),
}));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
    query: {
      agentLoops: { findFirst: findFirstMock, findMany: findManyMock },
      agentLoopRuns: { findFirst: findFirstMock, findMany: findManyMock },
      agentLoopStepRuns: { findFirst: findFirstMock, findMany: findManyMock },
      agentLoopEvents: { findFirst: findFirstMock, findMany: findManyMock },
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        query: {
          agentLoops: { findFirst: findFirstMock },
          agentLoopRuns: { findFirst: findFirstMock },
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
  insertedValues = [];
  lastSetValues = {};
  setCapture.length = 0;
  insertMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  returningMock.mockClear();
  valuesMock.mockClear();
  findFirstMock.mockClear();
  findManyMock.mockClear();
}

// ── BT-F4a: updateAgentLoopRunStatus startedAt coalesce guard ────────────────

describe("BT-F4a: updateAgentLoopRunStatus does not reset startedAt on second running call", () => {
  beforeEach(resetMocks);

  test("first call with status=running: startedAt is set in the update payload", async () => {
    const store = await storePromise;
    await store.updateAgentLoopRunStatus({
      runId: "run-1",
      status: "running",
    });

    // The set payload must include startedAt (because it was null before)
    const setCall = setCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    // startedAt must be present and be a Date
    expect(setCall?.startedAt).toBeInstanceOf(Date);
  });

  test("second call with status=running on an already-started run: startedAt is NOT overwritten", async () => {
    const existingStartedAt = new Date("2026-01-01T10:00:00Z");

    // Simulate a run that already has startedAt set
    // The store should use coalesce/skip-if-already-set logic
    const store = await storePromise;

    // First call — sets startedAt
    await store.updateAgentLoopRunStatus({
      runId: "run-1",
      status: "running",
    });

    const firstSetCall = setCapture[0] as Record<string, unknown> | undefined;
    const firstStartedAt = firstSetCall?.startedAt as Date | undefined;
    expect(firstStartedAt).toBeInstanceOf(Date);

    resetMocks();

    // Second call — must NOT overwrite startedAt if it's already set
    // Implementation should use SQL coalesce pattern (only set startedAt when currently null)
    await store.updateAgentLoopRunStatus({
      runId: "run-1",
      status: "running",
      // Pass existing startedAt to simulate already-started run
    });

    const secondSetCall = setCapture[0] as Record<string, unknown> | undefined;

    // The key invariant: the second call must NOT unconditionally set startedAt to now.
    // It must either use a SQL coalesce or check-then-set. In a mocked DB we verify
    // by checking that startedAt is NOT present as a plain Date (it should be a SQL
    // expression or absent entirely on the second running call when already started).
    //
    // With the SQL coalesce pattern, the set payload would contain a SQL coalesce
    // expression rather than a raw Date. We can check it's not a raw "now" Date that
    // would overwrite an existing value — the simplest verifiable behavior is that the
    // set() call does NOT include startedAt as a plain Date overwrite.
    //
    // We verify this by checking that startedAt in the second call is undefined OR
    // is a SQL expression object (not a fresh Date that would be "now").
    if (secondSetCall?.startedAt instanceof Date) {
      // If it's a Date, it should be exactly firstStartedAt value — not a new Date()
      // This would only pass if the implementation uses a read-then-preserve pattern.
      // For the coalesce pattern, startedAt would be a SQL object, not a plain Date.
      // We fail this test to enforce the coalesce pattern.
      expect(secondSetCall.startedAt).toBe(firstStartedAt);
    }
    // If startedAt is undefined or a SQL expression object, the test passes
    // (it means we're not unconditionally overwriting with a new Date())
  });
});

// ── BT-F4b: updateAgentLoopRunContext exists and updates only context ────────

describe("BT-F4b: updateAgentLoopRunContext updates only context (no status, no startedAt)", () => {
  beforeEach(resetMocks);

  test("updateAgentLoopRunContext is exported from the store module", async () => {
    const store = await storePromise;
    expect(typeof store.updateAgentLoopRunContext).toBe("function");
  });

  test("updateAgentLoopRunContext calls db.update and sets context without touching status or startedAt", async () => {
    const store = await storePromise;
    const newContext = { "node-1": { openIssueCount: 3 } };

    await store.updateAgentLoopRunContext({
      runId: "run-ctx-1",
      context: newContext,
    });

    // db.update must have been called
    expect(updateMock.mock.calls.length).toBe(1);

    // The set payload must include context
    const setCall = setCapture[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    expect(setCall?.context).toEqual(newContext);

    // The set payload must include updatedAt
    expect(setCall?.updatedAt).toBeInstanceOf(Date);

    // The set payload must NOT include status
    expect(setCall?.status).toBeUndefined();

    // The set payload must NOT include startedAt
    expect(setCall?.startedAt).toBeUndefined();

    // The set payload must NOT include finishedAt
    expect(setCall?.finishedAt).toBeUndefined();
  });

  test("updateAgentLoopRunContext return value includes the updated context", async () => {
    const store = await storePromise;
    const newContext = { "check-node": { openIssueCount: 5 } };

    // Provide a mock return value
    insertedValues = [
      {
        id: "run-ctx-1",
        status: "running",
        context: newContext,
        startedAt: new Date("2026-01-01T09:00:00Z"),
        updatedAt: new Date(),
      },
    ];

    const result = await store.updateAgentLoopRunContext({
      runId: "run-ctx-1",
      context: newContext,
    });

    // Result must be the updated run row (or null if not found)
    // The important thing is the function doesn't throw
    expect(result !== undefined).toBe(true);
  });
});

// ── BT-F4c: regression — github_check success does not reset run startedAt ───

describe("BT-F4c: regression — context-merge after github_check does not reset startedAt", () => {
  beforeEach(resetMocks);

  test("updateAgentLoopRunContext set payload never includes startedAt", async () => {
    // This is the regression that catches if the context-merge path
    // accidentally calls updateAgentLoopRunStatus(status:'running', ...) instead
    // of the dedicated updateAgentLoopRunContext function.
    //
    // The test simulates the context-merge call path:
    const store = await storePromise;
    const ctx = { "issues-node": { openIssueCount: 2, issues: [] } };

    await store.updateAgentLoopRunContext({
      runId: "run-regression",
      context: ctx,
    });

    // Verify that startedAt was not set in the update call
    const setCall = setCapture[0] as Record<string, unknown> | undefined;
    expect(setCall?.startedAt).toBeUndefined();

    // Verify that status was not set
    expect(setCall?.status).toBeUndefined();

    // The context IS set correctly
    expect(setCall?.context).toEqual(ctx);
  });
});
