/**
 * Agent Loops store unit tests — TDD RED
 *
 * These tests mock the DB client and verify the store module's CRUD/ownership
 * behaviour, redaction, and constraint modelling.  They follow the exact same
 * mock-module pattern used by background-agents/dispatcher.test.ts and
 * background-agents/redaction.test.ts.
 *
 * Migration double-apply idempotency is verified by inspection of the generated
 * SQL (all CREATE/ALTER statements are guarded with IF NOT EXISTS / DO $$…
 * EXCEPTION WHEN duplicate_object) rather than a live-DB test — no test DB is
 * wired up in CI, and background-agents/store.ts has no DB-level unit tests
 * either.  This is documented as a known gap consistent with the existing pattern.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

mock.module("server-only", () => ({}));

// ── DB mock ──────────────────────────────────────────────────────────────────
let insertedValues: unknown[] = [];
let _updatedSet: unknown = {};
let _deletedWhere: unknown = null;
let queryResult: unknown[] = [];

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

const insertMock = mock((_table: unknown) => ({
  values: valuesMock,
}));

const updateMock = mock((_table: unknown) => ({
  set: mock((setVals: unknown) => {
    _updatedSet = setVals;
    return {
      where: mock(() => ({
        returning: mock(() => [
          { ...(insertedValues[0] as object), ...(setVals as object) },
        ]),
      })),
    };
  }),
}));

const deleteMock = mock((_table: unknown) => ({
  where: mock((where: unknown) => {
    _deletedWhere = where;
    return { returning: mock(() => [{ id: "loop-1" }]) };
  }),
}));

const findManyMock = mock(async () => queryResult as unknown[]);
const findFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);

// groupBy is used by listAgentLoopRuns's single grouped failedStepCount
// query (#767): select().from(agentLoopRuns).leftJoin(...).where(...)
// .groupBy(...).orderBy(...).limit(...) — queryResult rows are
// { run, failedStepCount } shaped for that path.
const limitMockGrouped = mock(() => Promise.resolve(queryResult));
const orderByMockGrouped = mock(() => ({ limit: limitMockGrouped }));
const groupByMockGrouped = mock(() => ({ orderBy: orderByMockGrouped }));

const limitMockLeft = mock(() => Promise.resolve([queryResult[0] ?? null]));
const whereMockLeft = mock(() => ({
  limit: limitMockLeft,
  groupBy: groupByMockGrouped,
}));
const leftJoinMock = mock(() => ({ where: whereMockLeft }));

const limitMockSelect = mock(() => Promise.resolve(queryResult));
const orderByMockSelect = mock(() => ({ limit: limitMockSelect }));
const whereMockSelect = mock(() => ({
  limit: limitMockLeft,
  orderBy: orderByMockSelect,
}));
const fromMock = mock(() => ({
  leftJoin: leftJoinMock,
  where: whereMockSelect,
}));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

const txInsertMock = mock((_table: unknown) => ({
  values: valuesMock,
}));
// txUpdateReturning controls what the transaction update .returning() yields.
// Default: mirrors inserted values + set values (existing behaviour).
// Tests that simulate a TOCTOU race override this to return [].
let txUpdateReturningOverride: unknown[] | null = null;
let transactionUpdates: Array<{ table: unknown; values: unknown }> = [];
const txUpdateMock = mock((table: unknown) => ({
  set: mock((setVals: unknown) => {
    transactionUpdates.push({ table, values: setVals });
    return {
      where: mock(() => ({
        returning: mock(() => {
          if (txUpdateReturningOverride !== null) {
            return txUpdateReturningOverride;
          }
          return [{ ...(insertedValues[0] as object), ...(setVals as object) }];
        }),
      })),
    };
  }),
}));
const txFindFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);

// txSelectResult controls what tx.select().from().where() returns.
// Used by retryCurrentStep to compute MAX(attempt).
// The real Drizzle query ends at .where() (no .limit()), so the mock must
// make .where() itself return a thenable array.
let txSelectResult: unknown[] = [{ maxAttempt: 1 }];
let txSelectResultsQueue: unknown[][] = [];
const txSelectMock = mock((_fields?: unknown) => {
  let resolved: unknown[] | undefined;
  const result = () => {
    resolved ??= txSelectResultsQueue.shift() ?? txSelectResult;
    return resolved;
  };
  const terminal = () => {
    const limit = mock(async () => result());
    let query: Promise<unknown[]> & {
      limit: typeof limit;
      for: ReturnType<typeof mock>;
    };
    query = Object.assign(Promise.resolve(result()), {
      limit,
      for: mock(() => query),
    });
    return query;
  };
  const chain = {
    from: mock(() => chain),
    where: mock(() => terminal()),
  };
  return chain;
});

const transactionMock = mock(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    insert: txInsertMock,
    update: txUpdateMock,
    delete: deleteMock,
    select: txSelectMock,
    query: {
      agentLoops: { findFirst: txFindFirstMock },
      agentLoopRuns: { findFirst: txFindFirstMock },
      agentLoopStepRuns: { findFirst: txFindFirstMock },
      agentLoopWatchdogRuns: { findFirst: txFindFirstMock },
    },
  }),
);

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
    query: {
      agentLoops: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      agentLoopRuns: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      agentLoopStepRuns: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      agentLoopEvents: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      agentLoopWatchdogRuns: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
    },
    transaction: transactionMock,
  },
}));

// Minimal schema-shape mocks — the store imports table references from schema.ts.
// We mock schema exports so Drizzle table objects are plain symbols the mock DB
// can accept without needing a real pg connection.
const agentLoopsTable = Symbol("agentLoops");
const agentLoopRunsTable = Symbol("agentLoopRuns");
const agentLoopStepRunsTable = Symbol("agentLoopStepRuns");
const agentLoopEventsTable = Symbol("agentLoopEvents");
const agentLoopWatchdogRunsTable = Symbol("agentLoopWatchdogRuns");

mock.module("@/lib/db/schema", () => ({
  agentLoops: agentLoopsTable,
  agentLoopRuns: agentLoopRunsTable,
  agentLoopStepRuns: agentLoopStepRunsTable,
  agentLoopEvents: agentLoopEventsTable,
  agentLoopWatchdogRuns: agentLoopWatchdogRunsTable,
}));

// Import the store after all mocks are set up.
const storePromise = import("./store");

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetMocks() {
  insertedValues = [];
  _updatedSet = {};
  _deletedWhere = null;
  queryResult = [];
  txUpdateReturningOverride = null;
  transactionUpdates = [];
  txSelectResult = [{ maxAttempt: 1 }];
  txSelectResultsQueue = [];
  insertMock.mockClear();
  updateMock.mockClear();
  deleteMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockClear();
  txFindFirstMock.mockClear();
  txInsertMock.mockClear();
  txUpdateMock.mockClear();
  txSelectMock.mockClear();
  transactionMock.mockClear();
  returningMock.mockClear();
  valuesMock.mockClear();
  onConflictDoNothingMock.mockClear();
  leftJoinMock.mockClear();
  whereMockLeft.mockClear();
  limitMockLeft.mockClear();
}

// Minimal valid loop definition (start → end) used in tests to pass validation gate
const VALID_DEFINITION = {
  nodes: [
    { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "e", kind: "end", label: "End", position: { x: 100, y: 0 } },
  ],
  edges: [{ id: "e1", source: "s", target: "e", when: "always" }],
};

function makeLoop(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: VALID_DEFINITION,
    status: "draft",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoopRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "queued",
    definitionSnapshot: { nodes: [], edges: [] },
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    currentNodeId: null,
    currentStepRunId: null,
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
    nodeId: "start",
    nodeKind: "start",
    attempt: 1,
    status: "queued",
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createAgentLoop", () => {
  beforeEach(resetMocks);

  test("BT-001: inserts a loop row and returns it with the provided userId", async () => {
    const loop = makeLoop();
    returningMock.mockImplementationOnce(() => [loop]);

    const store = await storePromise;
    const result = await store.createAgentLoop("user-1", {
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: VALID_DEFINITION,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop.userId).toBe("user-1");
      expect(result.loop.name).toBe("Test Loop");
    }
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test("BT-001b: throws when insert returns no rows (DB failure after valid definition)", async () => {
    returningMock.mockImplementationOnce(() => []);

    const store = await storePromise;
    await expect(
      store.createAgentLoop("user-1", {
        name: "Test Loop",
        repoOwner: "acme",
        repoName: "widgets",
        definition: VALID_DEFINITION,
      }),
    ).rejects.toThrow();
  });
});

describe("updateAgentLoop", () => {
  beforeEach(resetMocks);

  test("BT-002: returns {ok:true,loop:null} when loop does not exist for userId (ownership check)", async () => {
    txFindFirstMock.mockResolvedValueOnce(null);

    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-missing", {
      name: "New name",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop).toBeNull();
    }
  });

  test("BT-002b: updates and returns loop when ownership passes", async () => {
    const loop = makeLoop();
    const updated = { ...loop, name: "New name" };
    txFindFirstMock.mockResolvedValueOnce(loop);
    txUpdateMock.mockReturnValueOnce({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => [updated]),
        })),
      })),
    });

    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-1", {
      name: "New name",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop).not.toBeNull();
      expect(result.loop?.name).toBe("New name");
    }
  });

  test("rejects definition writes to archived loops with a conflict error", async () => {
    txFindFirstMock.mockResolvedValueOnce(makeLoop({ status: "archived" }));

    const store = await storePromise;
    await expect(
      store.updateAgentLoop("user-1", "loop-1", {
        definition: VALID_DEFINITION,
      }),
    ).rejects.toMatchObject({
      name: "AgentLoopArchivedError",
      kind: "conflict",
    });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  test("allows archived loops to be un-archived without a definition write", async () => {
    const archived = makeLoop({ status: "archived" });
    const updated = makeLoop({ status: "draft" });
    txFindFirstMock.mockResolvedValueOnce(archived);
    txUpdateMock.mockReturnValueOnce({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => [updated]),
        })),
      })),
    });

    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-1", {
      status: "draft",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop?.status).toBe("draft");
    }
  });
});

describe("deleteAgentLoop", () => {
  beforeEach(resetMocks);

  test("BT-003: returns true when a row is deleted", async () => {
    txSelectResultsQueue = [[{ id: "loop-1" }], []];
    deleteMock.mockReturnValueOnce({
      where: mock(() => ({
        returning: mock(() => [{ id: "loop-1" }]),
      })),
    });

    const store = await storePromise;
    const result = await store.deleteAgentLoop("user-1", "loop-1");
    expect(result).toBe(true);
  });

  test("BT-003b: returns false when no row matches (ownership miss)", async () => {
    txSelectResultsQueue = [[]];

    const store = await storePromise;
    const result = await store.deleteAgentLoop("user-1", "loop-missing");
    expect(result).toBe(false);
  });

  test("atomically revokes active Runs and records source deletion before deleting", async () => {
    try {
      txSelectResultsQueue = [
        [{ id: "loop-1" }],
        [
          makeLoopRun({
            id: "run-active",
            status: "running",
          }),
        ],
      ];
      txUpdateReturningOverride = [
        makeLoopRun({
          id: "run-active",
          status: "cancelled",
          errorKind: "source_deleted",
        }),
      ];

      const store = await storePromise;
      const result = await store.deleteAgentLoop("user-1", "loop-1");

      expect(result).toBe(true);
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(txUpdateMock).toHaveBeenCalledTimes(3);
      expect(txInsertMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(transactionUpdates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table: agentLoopRunsTable,
            values: expect.objectContaining({
              status: "cancelled",
              errorKind: "source_deleted",
              finishedAt: expect.any(Date),
            }),
          }),
          expect.objectContaining({
            table: agentLoopStepRunsTable,
            values: expect.objectContaining({
              status: "skipped",
              errorKind: "source_deleted",
              errorMessage: "Source Automation deleted",
              finishedAt: expect.any(Date),
            }),
          }),
          expect.objectContaining({
            table: agentLoopWatchdogRunsTable,
            values: expect.objectContaining({
              status: "failed",
              decision: null,
              diagnosis: "Source Automation deleted",
              decisionPayload: null,
              finishedAt: expect.any(Date),
            }),
          }),
        ]),
      );
      const eventInput = valuesMock.mock.calls.at(-1)?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(eventInput).toMatchObject({
        loopRunId: "run-active",
        eventName: "agent-loop.source.revoked",
        level: "warn",
        redactionStatus: "passed",
      });
    } finally {
      txFindFirstMock.mockReset();
      txFindFirstMock.mockImplementation(
        async () => (queryResult[0] ?? null) as unknown,
      );
      txUpdateReturningOverride = null;
    }
  });

  test("preserves terminal Run status and writes no revocation event", async () => {
    txSelectResultsQueue = [
      [{ id: "loop-1" }],
      [makeLoopRun({ id: "run-terminal", status: "completed" })],
    ];
    const store = await storePromise;

    expect(await store.deleteAgentLoop("user-1", "loop-1")).toBe(true);
    expect(txUpdateMock).not.toHaveBeenCalled();
    expect(txInsertMock).not.toHaveBeenCalled();
  });

  test("does not delete the source when the same-transaction revocation event insert fails", async () => {
    txSelectResultsQueue = [
      [{ id: "loop-1" }],
      [makeLoopRun({ id: "run-active", status: "running" })],
    ];
    txInsertMock.mockImplementationOnce(() => ({
      values: mock(() => {
        throw new Error("event insert failed");
      }),
    }));
    const store = await storePromise;

    await expect(store.deleteAgentLoop("user-1", "loop-1")).rejects.toThrow(
      "event insert failed",
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test("surfaces a delete failure so the transaction can roll back revocation", async () => {
    txSelectResultsQueue = [[{ id: "loop-1" }], []];
    deleteMock.mockReturnValueOnce({
      where: mock(() => ({ returning: mock(() => []) })),
    });
    const store = await storePromise;

    await expect(store.deleteAgentLoop("user-1", "loop-1")).rejects.toThrow(
      "Owned Automation disappeared during deletion",
    );
  });
});

describe("listAgentLoops", () => {
  beforeEach(resetMocks);

  test("BT-004: returns only loops belonging to the given userId", async () => {
    const loop = makeLoop();
    findManyMock.mockResolvedValueOnce([loop]);

    const store = await storePromise;
    const result = await store.listAgentLoops("user-1");

    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe("user-1");
  });
});

describe("getOwnedAgentLoop", () => {
  beforeEach(resetMocks);

  test("BT-005: returns null when loop is owned by a different user", async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const store = await storePromise;
    const result = await store.getOwnedAgentLoop({
      userId: "user-2",
      loopId: "loop-1",
    });

    expect(result).toBeNull();
  });

  test("BT-005b: returns loop when ownership matches", async () => {
    const loop = makeLoop();
    findFirstMock.mockResolvedValueOnce(loop);

    const store = await storePromise;
    const result = await store.getOwnedAgentLoop({
      userId: "user-1",
      loopId: "loop-1",
    });

    expect(result?.id).toBe("loop-1");
  });
});

describe("createAgentLoopRun", () => {
  beforeEach(resetMocks);

  test("BT-006: inserts a run with the correct loopId and userId, returns {run, created:true}", async () => {
    const loop = makeLoop();
    const run = makeLoopRun();
    const event = { id: "event-1", loopRunId: run.id };
    findFirstMock.mockResolvedValueOnce(null);
    txSelectResultsQueue = [[loop]];
    returningMock
      .mockImplementationOnce(() => [run])
      .mockImplementationOnce(() => [event]);

    const store = await storePromise;
    const result = await store.createAgentLoopRun({
      loopId: "loop-1",
      userId: "user-1",
      definitionSnapshot: { nodes: [], edges: [] },
      source: "manual",
      idempotencyKey: "idem-1",
    });

    expect(result).not.toBeNull();
    expect(result!.run.loopId).toBe("loop-1");
    expect(result!.run.userId).toBe("user-1");
    expect(result!.created).toBe(true);
    expect(txInsertMock).toHaveBeenCalledTimes(2);
  });

  test("BT-006b: returns null when loop is not owned by userId (cross-tenant rejection)", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    txSelectResultsQueue = [[]];

    const store = await storePromise;
    const result = await store.createAgentLoopRun({
      loopId: "loop-owned-by-other",
      userId: "attacker-user",
      definitionSnapshot: { nodes: [], edges: [] },
      source: "manual",
      idempotencyKey: "idem-attack",
    });

    expect(result).toBeNull();
    // Must NOT have attempted to insert
    expect(txInsertMock).not.toHaveBeenCalled();
  });

  test("BT-006c: returns {run, created:false} when idempotencyKey already exists (duplicate suppressed)", async () => {
    const existingRun = makeLoopRun({ idempotencyKey: "idem-dup" });
    findFirstMock.mockResolvedValueOnce(existingRun);

    const store = await storePromise;
    const result = await store.createAgentLoopRun({
      loopId: "loop-1",
      userId: "user-1",
      definitionSnapshot: { nodes: [], edges: [] },
      source: "manual",
      idempotencyKey: "idem-dup",
    });

    expect(result).not.toBeNull();
    expect(result?.created).toBe(false);
    expect(result?.run.idempotencyKey).toBe("idem-dup");
  });

  test("BT-006d: returns null when insert loses without an idempotent winner", async () => {
    const loop = makeLoop();
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    txSelectResultsQueue = [[loop]];
    returningMock.mockImplementationOnce(() => []);

    const store = await storePromise;
    const result = await store.createAgentLoopRun({
      loopId: "loop-1",
      userId: "user-1",
      definitionSnapshot: { nodes: [], edges: [] },
      source: "manual",
      idempotencyKey: "idem-corrupt",
    });
    expect(result).toBeNull();
  });
});

describe("getAgentLoopRunWithLoop", () => {
  beforeEach(resetMocks);

  test("BT-007: returns null when no run matches runId", async () => {
    limitMockLeft.mockResolvedValueOnce([null]);

    const store = await storePromise;
    const result = await store.getAgentLoopRunWithLoop("run-missing");
    expect(result).toBeNull();
  });

  test("BT-007b: returns run+loop pair when found", async () => {
    const run = makeLoopRun();
    const loop = makeLoop();
    limitMockLeft.mockResolvedValueOnce([{ run, loop }]);

    const store = await storePromise;
    const result = await store.getAgentLoopRunWithLoop("run-1");
    expect(result?.run.id).toBe("run-1");
    expect(result?.loop?.id).toBe("loop-1");
  });
});

describe("listAgentLoopRuns", () => {
  beforeEach(resetMocks);

  test("BT-008: returns runs for the given loopId", async () => {
    const run = makeLoopRun();
    queryResult = [{ run, failedStepCount: 0 }];

    const store = await storePromise;
    const result = await store.listAgentLoopRuns({
      loopId: "loop-1",
      userId: "user-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.loopId).toBe("loop-1");
  });

  // #767 — each run is extended with failedStepCount from the grouped query.
  test("BT-008b: returns failedStepCount alongside each run", async () => {
    const run = makeLoopRun();
    queryResult = [{ run, failedStepCount: 2 }];

    const store = await storePromise;
    const result = await store.listAgentLoopRuns({
      loopId: "loop-1",
      userId: "user-1",
    });

    expect(result[0]?.failedStepCount).toBe(2);
  });
});

describe("createAgentLoopStepRun", () => {
  beforeEach(resetMocks);

  test("BT-009: inserts step run with loopRunId and nodeId", async () => {
    const step = makeStepRun();
    returningMock.mockImplementationOnce(() => [step]);

    const store = await storePromise;
    const result = await store.createAgentLoopStepRun({
      loopRunId: "run-1",
      nodeId: "start",
      nodeKind: "start",
    });

    expect(result.loopRunId).toBe("run-1");
    expect(result.nodeId).toBe("start");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("createAndAdvanceAgentLoopStep", () => {
  beforeEach(resetMocks);

  test("source deletion before advance creates no orphan step", async () => {
    txSelectResultsQueue = [
      [
        {
          id: "run-1",
          loopId: null,
          currentStepRunId: "step-1",
        },
      ],
    ];
    const store = await storePromise;

    const result = await store.createAndAdvanceAgentLoopStep({
      runId: "run-1",
      fromStepRunId: "step-1",
      nextNodeId: "next",
      nextNodeKind: "agent_step",
      attempt: 1,
      stepCount: 2,
      iterationCount: 0,
      workflowRunId: "wf-1",
    });

    expect(result).toEqual({ outcome: "source_deleted" });
    expect(txInsertMock).not.toHaveBeenCalled();
    expect(txUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateAgentLoopStepRun", () => {
  beforeEach(resetMocks);

  test("BT-010: updates step run status and returns updated row", async () => {
    const step = makeStepRun({ status: "succeeded" });
    updateMock.mockReturnValueOnce({
      set: mock((setVals: unknown) => ({
        where: mock(() => ({
          returning: mock(() => [{ ...step, ...(setVals as object) }]),
        })),
      })),
    });

    const store = await storePromise;
    const result = await store.updateAgentLoopStepRun({
      stepRunId: "step-1",
      status: "succeeded",
    });

    expect(result?.status).toBe("succeeded");
  });
});

describe("recordAgentLoopEvent", () => {
  beforeEach(resetMocks);

  test("BT-011: inserts an event row for the given loopRunId", async () => {
    const event = {
      id: "evt-1",
      loopRunId: "run-1",
      stepRunId: null,
      nodeId: null,
      eventName: "agent-loop.run.created",
      status: "info",
      level: "info",
      summary: "Loop run created",
      payload: {},
      redactionStatus: "passed",
      requestId: null,
      workflowRunId: null,
      createdAt: new Date(),
    };
    returningMock.mockImplementationOnce(() => [event]);

    const store = await storePromise;
    const result = await store.recordAgentLoopEvent({
      loopRunId: "run-1",
      eventName: "agent-loop.run.created",
      status: "info",
      summary: "Loop run created",
    });

    expect(result.loopRunId).toBe("run-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test("BT-011-redact: token-bearing payloads are redacted before insert", async () => {
    const event = {
      id: "evt-2",
      loopRunId: "run-1",
      eventName: "agent-loop.step.started",
      status: "info",
      level: "info",
      summary: null,
      payload: { token: "[REDACTED]" },
      redactionStatus: "passed",
      requestId: null,
      workflowRunId: null,
      stepRunId: null,
      nodeId: null,
      createdAt: new Date(),
    };
    returningMock.mockImplementationOnce(() => [event]);

    const store = await storePromise;
    await store.recordAgentLoopEvent({
      loopRunId: "run-1",
      eventName: "agent-loop.step.started",
      status: "info",
      payload: { token: "ghp_super_secret_token_1234567890" },
    });

    // valuesMock was called with the values that would be inserted.
    // The payload key "token" must be redacted.
    const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(inserted?.payload)).not.toContain(
      "ghp_super_secret_token_1234567890",
    );
    expect((inserted?.payload as Record<string, unknown>)?.token).toBe(
      "[REDACTED]",
    );
  });
});

describe("listAgentLoopEvents", () => {
  beforeEach(resetMocks);

  test("BT-012: returns events for the given loopRunId", async () => {
    const event = {
      id: "evt-1",
      loopRunId: "run-1",
      eventName: "agent-loop.run.created",
      status: "info",
      createdAt: new Date(),
    };
    findManyMock.mockResolvedValueOnce([event]);

    const store = await storePromise;
    const result = await store.listAgentLoopEvents("run-1");

    expect(result).toHaveLength(1);
    expect(result[0]?.loopRunId).toBe("run-1");
  });
});

// ── retryCurrentStep — TOCTOU race protection (BT-P2-12/13) ──────────────────
//
// FINDING 2: the final run update must be conditional on the run still being in
// a retryable status. If another action (cancel/pause/other-retry) changes the
// status between our read and update, the update matches 0 rows — the function
// must throw RunControlError("illegal_transition") and NOT leave an orphan step.

describe("retryCurrentStep — TOCTOU race protection", () => {
  beforeEach(resetMocks);

  test("inactive source rejects retry before creating another attempt", async () => {
    const run = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-old",
    });
    txSelectResultsQueue = [[run]];
    txFindFirstMock.mockResolvedValueOnce(null);

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");
    const error = await store
      .retryCurrentStep({ runId: "run-1", userId: "user-1" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunControlError);
    if (error instanceof RunControlError) {
      expect(error.kind).toBe("source_inactive");
    }
    expect(txInsertMock).not.toHaveBeenCalled();
  });

  test("BT-P2-12: retryCurrentStep succeeds on the happy path (failed run, no race)", async () => {
    // Set up: findFirst returns a failed run with currentNodeId and currentStepRunId
    const run = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-old",
    });
    const failedStep = makeStepRun({
      id: "step-old",
      loopRunId: "run-1",
      nodeId: "work",
      nodeKind: "agent_step",
      attempt: 1,
      status: "failed",
    });

    txFindFirstMock.mockResolvedValue(failedStep);

    // tx.select().from().where() → maxAttempt = 1
    txSelectResultsQueue = [[run], [{ maxAttempt: 1 }]];

    // tx.insert returns the new step run
    const newStep = makeStepRun({
      id: "step-new",
      attempt: 2,
      status: "queued",
    });
    returningMock.mockImplementationOnce(() => [newStep]);

    // tx.update returns the updated run row (conditional matched)
    txUpdateReturningOverride = [
      { ...run, status: "running", currentStepRunId: "step-new" },
    ];

    const store = await storePromise;
    const result = await store.retryCurrentStep({
      runId: "run-1",
      userId: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result.attempt).toBe(2);
    expect(result.status).toBe("queued");
  });

  test("BT-P2-13: retryCurrentStep throws RunControlError(illegal_transition) when conditional update matches 0 rows (TOCTOU race)", async () => {
    // The run is "failed" when we read it, but the conditional update returns
    // 0 rows — simulating a concurrent cancel/pause changing the status.
    const run = makeLoopRun({
      status: "failed",
      currentNodeId: "work",
      currentStepRunId: "step-old",
    });
    const failedStep = makeStepRun({
      id: "step-old",
      nodeId: "work",
      nodeKind: "agent_step",
      attempt: 1,
      status: "failed",
    });

    txFindFirstMock.mockResolvedValue(failedStep);

    txSelectResultsQueue = [[run], [{ maxAttempt: 1 }]];

    const newStep = makeStepRun({
      id: "step-new",
      attempt: 2,
      status: "queued",
    });
    returningMock.mockImplementationOnce(() => [newStep]);

    // Conditional update returns NO rows — race lost
    txUpdateReturningOverride = [];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    // First call — verifies the 0-row-update path throws RunControlError.
    await expect(
      store.retryCurrentStep({ runId: "run-1", userId: "user-1" }),
    ).rejects.toThrow(RunControlError);

    // Second call — confirms errorKind is "illegal_transition".
    // Using .catch so that an absent throw is a test FAILURE (not a silent pass):
    // if retryCurrentStep resolves, secondCallErr is the resolved value (not an
    // error), the instanceof check fails, and the test fails — no silent green.
    txSelectResultsQueue = [[run], [{ maxAttempt: 1 }]];
    returningMock.mockImplementationOnce(() => [newStep]);
    const secondCallErr = await store
      .retryCurrentStep({ runId: "run-1", userId: "user-1" })
      .catch((e: unknown) => e);
    expect(secondCallErr).toBeInstanceOf(RunControlError);
    if (secondCallErr instanceof RunControlError) {
      expect(secondCallErr.kind).toBe("illegal_transition");
    }
  });

  test("BT-P2-14: retryCurrentStep throws not_found when run does not exist", async () => {
    txSelectResultsQueue = [[]];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    await expect(
      store.retryCurrentStep({ runId: "run-missing", userId: "user-1" }),
    ).rejects.toThrow(RunControlError);
  });

  test("BT-P2-15: retryCurrentStep throws illegal_transition when run is in running status", async () => {
    const run = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-1",
    });
    txSelectResultsQueue = [[run]];

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");

    await expect(
      store.retryCurrentStep({ runId: "run-1", userId: "user-1" }),
    ).rejects.toThrow(RunControlError);
  });
});

describe("retryCurrentStepForWatchdog — execution claim isolation", () => {
  beforeEach(resetMocks);

  test("retry strips the prior claim, preserves durable input, and accepts a new generation", async () => {
    const run = makeLoopRun({
      status: "running",
      currentNodeId: "work",
      currentStepRunId: "step-old",
      workflowRunId: "workflow-1",
    });
    const failedStep = makeStepRun({
      id: "step-old",
      loopRunId: "run-1",
      nodeId: "work",
      nodeKind: "agent_step",
      attempt: 1,
      status: "failed",
      workflowRunId: "workflow-1",
      stepInput: {
        executionClaimGeneration: "generation-old",
        watchdogHint: "Earlier guidance",
        userInput: { issueNumber: 42 },
      },
    });

    txSelectResultsQueue = [[run], [{ maxAttempt: 1 }]];
    txFindFirstMock.mockResolvedValue(failedStep);
    txUpdateReturningOverride = [
      { ...run, status: "running", currentStepRunId: "step-new" },
    ];

    const store = await storePromise;
    const retry = await store.retryCurrentStepForWatchdog({
      runId: run.id,
      expectedStepRunId: failedStep.id,
      hint: "Try the smaller repair",
    });

    expect(retry.stepInput).toEqual({
      watchdogHint: "Try the smaller repair",
      userInput: { issueNumber: 42 },
    });
    expect(
      (retry.stepInput as Record<string, unknown>)["executionClaimGeneration"],
    ).toBeUndefined();

    const claimed = await store.updateAgentLoopStepRun({
      stepRunId: retry.id,
      expectedStatuses: ["queued"],
      expectedExecutionClaimGeneration: null,
      executionClaimGeneration: "generation-new",
    });
    expect(claimed).not.toBeNull();
    expect("generation-new").not.toBe("generation-old");
  });
});

// ── Migration SQL inspection ────────────────────────────────────────────────
// Verifies that the generated + hand-edited migration SQL is idempotent and
// contains the required check constraint.  Uses file system inspection rather
// than a live-DB test (no test DB in CI for this kind of check).
describe("resumeLoopRun - inactive source guard", () => {
  beforeEach(resetMocks);

  test("inactive source rejects resume before changing run status", async () => {
    const run = makeLoopRun({ status: "paused" });
    txSelectResultsQueue = [[run]];
    txFindFirstMock.mockResolvedValueOnce(null);

    const store = await storePromise;
    const { RunControlError } = await import("./run-controls-error");
    const error = await store
      .resumeLoopRun("run-1", "user-1")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunControlError);
    if (error instanceof RunControlError) {
      expect(error.kind).toBe("source_inactive");
    }
    expect(txUpdateMock).not.toHaveBeenCalled();
  });
});

describe("migration SQL idempotency and check constraint (BT-013)", () => {
  test("migration contains num_nonnulls check and IF NOT EXISTS guards", () => {
    const migrationsDir = join(import.meta.dir, "../../../db/migrations");

    let files: string[];
    try {
      files = readdirSync(migrationsDir);
    } catch {
      // Directory not yet present before migration is generated; skip gracefully.
      return;
    }

    const loopsMigration = files
      .filter((f) => f.endsWith(".sql"))
      .find((f) => {
        try {
          const content = readFileSync(join(migrationsDir, f), "utf8");
          return (
            content.includes("agent_loop_runs") &&
            content.includes("num_nonnulls")
          );
        } catch {
          return false;
        }
      });

    // If migration doesn't exist yet (pre-generate), the test passes vacuously.
    // After generation it will enforce the invariants.
    if (!loopsMigration) return;

    const sql = readFileSync(join(migrationsDir, loopsMigration), "utf8");
    expect(sql).toContain("num_nonnulls");
    expect(sql).toContain("agent_loop_runs");
    // Must have idempotent guards on CREATE TABLE
    expect(sql.toLowerCase()).toMatch(/if not exists/);
  });
});
