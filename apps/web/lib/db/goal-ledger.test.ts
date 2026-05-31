/**
 * Tests for goal-ledger.ts CRUD helpers.
 *
 * These tests use a hand-crafted fakeDb (mocked ./client) so they run
 * entirely offline without a real database.
 *
 * NOTE: Real FK cascade / NOT NULL constraints are enforced by the generated
 * migration SQL (see ON DELETE CASCADE / NOT NULL in the 0048_jittery_carlie_cooper.sql
 * file), not by these unit tests.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock server-only so the module can be imported in the Bun test environment
mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

/** Last values passed to the insert chain */
let lastInsertValues: unknown = null;
/** Last values passed to the update set chain */
let lastUpdateValues: unknown = null;
/** Simulated max(sequence) value returned by the inner select in appendGoalEvent */
let fakeMaxSequence: number | null = null;
/** Rows returned by list* query chains */
let fakeSelectRows: unknown[] = [];
/** Row returned by insert().values().returning() */
let fakeInsertReturn: unknown = null;
/** Row returned by update().set().where().returning() */
let fakeUpdateReturn: unknown = null;
/**
 * When set to a non-null value, the first .select().from().where() call inside a
 * transaction returns this value (used for the parent-goal FOR UPDATE lock).
 * Subsequent .select() calls in the same tx return the max-sequence result.
 */
let fakeGoalLockReturn: unknown[] | null = null;
/** Track how many select calls have happened inside the current transaction */
let txSelectCallCount = 0;

// ---------------------------------------------------------------------------
// Fluent fake-db builder
// ---------------------------------------------------------------------------

/**
 * Explicit shape of the fake DB so TypeScript can resolve the recursive
 * reference in `transaction` without needing `ReturnType<typeof buildFakeDb>`.
 */
type FakeDb = {
  select: (_columns?: unknown) => {
    from: (_table: unknown) => {
      where: (_cond: unknown) => Promise<unknown[]> & {
        for: (_strength: unknown) => Promise<unknown[]>;
        orderBy: (..._args: unknown[]) => Promise<unknown[]>;
      };
      orderBy: (..._args: unknown[]) => Promise<unknown[]>;
    };
  };
  insert: (_table: unknown) => {
    values: (input: unknown) => {
      returning: () => Promise<unknown[]>;
    };
  };
  update: (_table: unknown) => {
    set: (vals: unknown) => {
      where: (_cond: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  };
  transaction: <T>(callback: (tx: FakeDb) => Promise<T>) => Promise<T>;
};

/**
 * Build a fake-db object whose every fluent chain captures arguments and
 * returns deterministic test data. The shape mirrors the Drizzle query-builder
 * API used by goal-ledger.ts.
 *
 * Design note on the select chain:
 *   appendGoalEvent now does:
 *     1. tx.select().from(workflowGoals).where(eq(...)).for("update") — parent goal lock
 *     2. tx.select({maxSeq:max(...)}).from(workflowGoalEvents).where(eq(...))  — max sequence
 *   listGoal* do:  await db.select().from(t).where(c).orderBy(asc(...))
 *                  or  await db.select().from(t).orderBy(asc(...))
 *
 * We track txSelectCallCount inside transactions: first select = goal lock,
 * second select = max-sequence. Outside transactions, selects return fakeSelectRows.
 */
function buildFakeDb(isInTx = false): FakeDb {
  return {
    // ---- select() chain -------------------------------------------------
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        // .where() → returned value is immediately awaited (max-sequence or goal-lock path)
        // OR chained with .orderBy() / .for() (list path or FOR UPDATE path)
        where: (_cond: unknown) => {
          if (isInTx) {
            txSelectCallCount += 1;
            const callIndex = txSelectCallCount;

            if (callIndex === 1 && fakeGoalLockReturn !== null) {
              // First tx select = parent goal FOR UPDATE lookup
              const lockResult = fakeGoalLockReturn;
              const basePromise = Promise.resolve(lockResult);
              return Object.assign(basePromise, {
                for: (_strength: unknown) => Promise.resolve(lockResult),
                orderBy: (..._args: unknown[]) =>
                  Promise.resolve(fakeSelectRows),
              });
            }

            // Second tx select (or first when fakeGoalLockReturn is null) = max-sequence
            const basePromise = Promise.resolve([
              { maxSeq: fakeMaxSequence },
            ] as unknown[]);
            return Object.assign(basePromise, {
              for: (_strength: unknown) =>
                Promise.resolve([{ maxSeq: fakeMaxSequence }] as unknown[]),
              orderBy: (..._args: unknown[]) => Promise.resolve(fakeSelectRows),
            });
          }

          // Outside transaction: list query path
          const basePromise = Promise.resolve([
            { maxSeq: fakeMaxSequence },
          ] as unknown[]);
          return Object.assign(basePromise, {
            for: (_strength: unknown) =>
              Promise.resolve([{ maxSeq: fakeMaxSequence }] as unknown[]),
            orderBy: (..._args: unknown[]) => Promise.resolve(fakeSelectRows),
          });
        },
        // .orderBy() directly (no .where()) — used by listGoals / listGoalEvents
        orderBy: (..._args: unknown[]) => Promise.resolve(fakeSelectRows),
      }),
    }),

    // ---- insert() chain -------------------------------------------------
    insert: (_table: unknown) => ({
      values: (input: unknown) => {
        lastInsertValues = input;
        return {
          returning: () =>
            Promise.resolve(
              fakeInsertReturn !== null ? [fakeInsertReturn] : [],
            ),
        };
      },
    }),

    // ---- update() chain -------------------------------------------------
    update: (_table: unknown) => ({
      set: (vals: unknown) => {
        lastUpdateValues = vals;
        return {
          where: (_cond: unknown) => ({
            returning: () =>
              Promise.resolve(
                fakeUpdateReturn !== null ? [fakeUpdateReturn] : [],
              ),
          }),
        };
      },
    }),

    // ---- transaction() --------------------------------------------------
    transaction: async <T>(callback: (tx: FakeDb) => Promise<T>) => {
      txSelectCallCount = 0;
      return callback(buildFakeDb(true));
    },
  };
}

let fakeDb = buildFakeDb();

mock.module("./client", () => ({
  get db() {
    return fakeDb;
  },
}));

// Mock drizzle-orm helper functions (eq, max, asc, and) so that the
// implementation can import them without a real DB driver. The fakeDb ignores
// these values anyway.
mock.module("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => Symbol("eq"),
  max: (..._args: unknown[]) => Symbol("max"),
  asc: (..._args: unknown[]) => Symbol("asc"),
  and: (..._args: unknown[]) => Symbol("and"),
  sql: (..._args: unknown[]) => Symbol("sql"),
}));

// ---------------------------------------------------------------------------
// Import module AFTER mocks are established
// ---------------------------------------------------------------------------
const goalLedgerPromise = import("./goal-ledger");

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  fakeDb = buildFakeDb();
  lastInsertValues = null;
  lastUpdateValues = null;
  fakeMaxSequence = null;
  fakeSelectRows = [];
  fakeInsertReturn = null;
  fakeUpdateReturn = null;
  fakeGoalLockReturn = null;
  txSelectCallCount = 0;
});

// ---------------------------------------------------------------------------
// BT-001: createGoal
// ---------------------------------------------------------------------------
describe("createGoal", () => {
  test("BT-001a: generates a nanoid, defaults status to draft, and sets evidenceRefs to []", async () => {
    const { createGoal } = await goalLedgerPromise;

    const now = new Date();
    fakeInsertReturn = {
      id: "generated-id",
      userId: "user-1",
      workflowRunId: null,
      sessionId: null,
      chatId: null,
      objective: "ship the feature",
      status: "draft",
      plan: null,
      blockedReason: null,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await createGoal({
      userId: "user-1",
      objective: "ship the feature",
    });

    expect(result.userId).toBe("user-1");
    expect(result.objective).toBe("ship the feature");
    expect(result.status).toBe("draft");
    expect(result.evidenceRefs).toEqual([]);
    // id must be a non-empty string (nanoid was generated)
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  test("BT-001b: passes the correct values to the insert chain including auto-generated id", async () => {
    const { createGoal } = await goalLedgerPromise;

    const now = new Date();
    fakeInsertReturn = {
      id: "gen-id-abc",
      userId: "user-2",
      objective: "another goal",
      status: "draft",
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    await createGoal({ userId: "user-2", objective: "another goal" });

    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.userId).toBe("user-2");
    expect(inserted.objective).toBe("another goal");
    expect(inserted.status).toBe("draft");
    expect(inserted.evidenceRefs).toEqual([]);
    // id must be a non-empty string (nanoid)
    expect(typeof inserted.id).toBe("string");
    expect((inserted.id as string).length).toBeGreaterThan(0);
  });

  test("BT-001c: accepts an explicit status override", async () => {
    const { createGoal } = await goalLedgerPromise;

    const now = new Date();
    fakeInsertReturn = {
      id: "gen-id-xyz",
      userId: "user-3",
      objective: "planned already",
      status: "planned",
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await createGoal({
      userId: "user-3",
      objective: "planned already",
      status: "planned",
    });

    expect(result.status).toBe("planned");
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.status).toBe("planned");
  });

  test("BT-001d: throws GoalLedgerError with code 'invalid_input' when objective is missing or empty", async () => {
    const { createGoal, GoalLedgerError } = await goalLedgerPromise;

    const err = await createGoal({
      userId: "user-1",
      objective: "",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "invalid_input",
    );
    expect((err as Error).message).toContain("objective");
  });

  test("BT-001e: throws GoalLedgerError with code 'persist_failed' when .returning() yields no row", async () => {
    const { createGoal, GoalLedgerError } = await goalLedgerPromise;

    // fakeInsertReturn stays null → returning() returns []
    fakeInsertReturn = null;

    const err = await createGoal({
      userId: "user-1",
      objective: "should fail to persist",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "persist_failed",
    );
  });
});

// ---------------------------------------------------------------------------
// BT-002: appendGoalEvent — sequence computation
// ---------------------------------------------------------------------------
describe("appendGoalEvent", () => {
  test("BT-002a: uses sequence 1 when no prior events exist (max returns null)", async () => {
    const { appendGoalEvent } = await goalLedgerPromise;

    fakeGoalLockReturn = [{ id: "goal-1" }]; // parent goal exists
    fakeMaxSequence = null; // NULL aggregate = no prior rows
    const now = new Date();
    fakeInsertReturn = {
      id: "event-1",
      goalId: "goal-1",
      userId: "user-1",
      sequence: 1,
      eventType: "objective_set",
      summary: "Goal created",
      payload: {},
      createdAt: now,
    };

    const result = await appendGoalEvent({
      goalId: "goal-1",
      userId: "user-1",
      eventType: "objective_set",
      summary: "Goal created",
    });

    expect(result.sequence).toBe(1);
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.sequence).toBe(1);
  });

  test("BT-002b: increments sequence by 1 when prior events exist (max=3 → next=4)", async () => {
    const { appendGoalEvent } = await goalLedgerPromise;

    fakeGoalLockReturn = [{ id: "goal-1" }]; // parent goal exists
    fakeMaxSequence = 3;
    const now = new Date();
    fakeInsertReturn = {
      id: "event-4",
      goalId: "goal-1",
      userId: "user-1",
      sequence: 4,
      eventType: "step_started",
      summary: "Step A started",
      payload: {},
      createdAt: now,
    };

    const result = await appendGoalEvent({
      goalId: "goal-1",
      userId: "user-1",
      eventType: "step_started",
      summary: "Step A started",
    });

    expect(result.sequence).toBe(4);
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.sequence).toBe(4);
  });

  test("BT-002c: persists all required fields on the event row", async () => {
    const { appendGoalEvent } = await goalLedgerPromise;

    fakeGoalLockReturn = [{ id: "goal-xyz" }]; // parent goal exists
    fakeMaxSequence = 0;
    const now = new Date();
    fakeInsertReturn = {
      id: "event-abc",
      goalId: "goal-xyz",
      userId: "user-99",
      sequence: 1,
      eventType: "evidence_attached",
      summary: "Attached proof.png",
      payload: { fileRef: "proof.png" },
      createdAt: now,
    };

    const result = await appendGoalEvent({
      goalId: "goal-xyz",
      userId: "user-99",
      eventType: "evidence_attached",
      summary: "Attached proof.png",
      payload: { fileRef: "proof.png" },
    });

    expect(result.goalId).toBe("goal-xyz");
    expect(result.userId).toBe("user-99");
    expect(result.eventType).toBe("evidence_attached");
    expect(result.summary).toBe("Attached proof.png");
    expect((result.payload as Record<string, unknown>).fileRef).toBe(
      "proof.png",
    );
  });

  test("BT-002d: throws GoalLedgerError with code 'not_found' when parent goal does not exist", async () => {
    const { appendGoalEvent, GoalLedgerError } = await goalLedgerPromise;

    // No parent goal row returned from the FOR UPDATE lock query
    fakeGoalLockReturn = [];

    const err = await appendGoalEvent({
      goalId: "missing-goal",
      userId: "user-1",
      eventType: "note",
      summary: "Should fail",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "not_found",
    );
  });

  test("BT-002e: throws GoalLedgerError with code 'persist_failed' when event insert returns no row", async () => {
    const { appendGoalEvent, GoalLedgerError } = await goalLedgerPromise;

    fakeGoalLockReturn = [{ id: "goal-1" }]; // parent goal exists
    fakeMaxSequence = 0;
    fakeInsertReturn = null; // insert returns []

    const err = await appendGoalEvent({
      goalId: "goal-1",
      userId: "user-1",
      eventType: "note",
      summary: "Should fail",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "persist_failed",
    );
  });
});

// ---------------------------------------------------------------------------
// BT-003: listGoalEvents — ordered by sequence ascending
// ---------------------------------------------------------------------------
describe("listGoalEvents", () => {
  test("BT-003: returns events in the order provided by the data layer (ascending sequence)", async () => {
    const { listGoalEvents } = await goalLedgerPromise;

    const now = new Date();
    fakeSelectRows = [
      {
        id: "e1",
        goalId: "goal-1",
        sequence: 1,
        eventType: "objective_set",
        summary: "first",
        payload: {},
        createdAt: now,
      },
      {
        id: "e2",
        goalId: "goal-1",
        sequence: 2,
        eventType: "step_started",
        summary: "second",
        payload: {},
        createdAt: now,
      },
      {
        id: "e3",
        goalId: "goal-1",
        sequence: 3,
        eventType: "step_completed",
        summary: "third",
        payload: {},
        createdAt: now,
      },
    ];

    const results = await listGoalEvents("goal-1");

    expect(results).toHaveLength(3);
    expect(results[0].sequence).toBe(1);
    expect(results[1].sequence).toBe(2);
    expect(results[2].sequence).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BT-004: listGoals — filters by the provided dimension
// ---------------------------------------------------------------------------
describe("listGoals", () => {
  test("BT-004a: returns goals when filtering by userId", async () => {
    const { listGoals } = await goalLedgerPromise;

    const now = new Date();
    fakeSelectRows = [
      {
        id: "g1",
        userId: "user-1",
        objective: "Goal one",
        status: "running",
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "g2",
        userId: "user-1",
        objective: "Goal two",
        status: "draft",
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    const results = await listGoals({ userId: "user-1" });
    expect(results).toHaveLength(2);
    expect(results[0].userId).toBe("user-1");
    expect(results[1].userId).toBe("user-1");
  });

  test("BT-004b: returns goals when filtering by workflowRunId", async () => {
    const { listGoals } = await goalLedgerPromise;

    const now = new Date();
    fakeSelectRows = [
      {
        id: "g3",
        userId: "user-1",
        workflowRunId: "run-42",
        objective: "workflow goal",
        status: "planned",
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    const results = await listGoals({ workflowRunId: "run-42" });
    expect(results).toHaveLength(1);
    expect((results[0] as { workflowRunId?: string }).workflowRunId).toBe(
      "run-42",
    );
  });

  test("BT-004c: returns goals when filtering by sessionId", async () => {
    const { listGoals } = await goalLedgerPromise;

    const now = new Date();
    fakeSelectRows = [
      {
        id: "g4",
        userId: "user-1",
        sessionId: "session-7",
        objective: "session goal",
        status: "complete",
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    const results = await listGoals({ sessionId: "session-7" });
    expect(results).toHaveLength(1);
    expect((results[0] as { sessionId?: string }).sessionId).toBe("session-7");
  });

  test("BT-004d: throws GoalLedgerError with code 'invalid_input' when no filter is provided", async () => {
    const { listGoals, GoalLedgerError } = await goalLedgerPromise;

    const err = await listGoals({}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "invalid_input",
    );
  });
});

// ---------------------------------------------------------------------------
// BT-005: closeGoal — sets a terminal status; rejects non-terminal statuses
// ---------------------------------------------------------------------------
describe("closeGoal", () => {
  test("BT-005a: updates status and updatedAt when given a terminal status", async () => {
    const { closeGoal } = await goalLedgerPromise;

    const now = new Date();
    fakeUpdateReturn = {
      id: "goal-1",
      userId: "user-1",
      objective: "done",
      status: "complete",
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await closeGoal("goal-1", "complete");

    expect(result.status).toBe("complete");
    const updated = lastUpdateValues as Record<string, unknown>;
    expect(updated.status).toBe("complete");
    expect(updated.updatedAt).toBeInstanceOf(Date);
  });

  test("BT-005b: throws GoalLedgerError with code 'non_terminal_status' for non-terminal status", async () => {
    const { closeGoal, GoalLedgerError } = await goalLedgerPromise;

    const err = await closeGoal("goal-1", "running" as never).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "non_terminal_status",
    );
    expect((err as Error).message).toContain("terminal");
  });

  test("BT-005c: accepts all terminal statuses without throwing", async () => {
    const { closeGoal, TERMINAL_GOAL_STATUSES } = await goalLedgerPromise;

    const now = new Date();
    for (const status of TERMINAL_GOAL_STATUSES) {
      fakeUpdateReturn = {
        id: "goal-x",
        userId: "user-1",
        objective: "done",
        status,
        evidenceRefs: [],
        createdAt: now,
        updatedAt: now,
      };
      const result = await closeGoal("goal-x", status);
      expect(result.status).toBe(status);
    }
  });

  test("BT-005d: throws GoalLedgerError with code 'not_found' when no row is updated (goal does not exist)", async () => {
    const { closeGoal, GoalLedgerError } = await goalLedgerPromise;

    // fakeUpdateReturn stays null → returning() returns []
    fakeUpdateReturn = null;

    const err = await closeGoal("missing-goal", "complete").catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "not_found",
    );
  });
});

// ---------------------------------------------------------------------------
// REGRESSION tests — catch future breakage from different angles
// ---------------------------------------------------------------------------

describe("regression: TERMINAL_GOAL_STATUSES contract", () => {
  test("REG-001: TERMINAL_GOAL_STATUSES contains exactly complete, failed, canceled, archived", async () => {
    // If the terminal set is changed (e.g. accidentally widened or narrowed),
    // this test catches it. The set is the source of truth for closeGoal's guard.
    const { TERMINAL_GOAL_STATUSES } = await goalLedgerPromise;

    expect(TERMINAL_GOAL_STATUSES).toContain("complete");
    expect(TERMINAL_GOAL_STATUSES).toContain("failed");
    expect(TERMINAL_GOAL_STATUSES).toContain("canceled");
    expect(TERMINAL_GOAL_STATUSES).toContain("archived");
    // Non-terminal statuses must NOT be in the set
    const nonTerminal = [
      "draft",
      "planned",
      "running",
      "awaiting_input",
      "blocked",
      "validating",
    ];
    for (const s of nonTerminal) {
      expect((TERMINAL_GOAL_STATUSES as readonly string[]).includes(s)).toBe(
        false,
      );
    }
  });

  test("REG-002: appendGoalEvent sequence starts at 1, not 0, when no prior events exist", async () => {
    // If the +1 offset is accidentally removed, sequence would be 0 for the
    // first event, breaking the event-ordering contract.
    const { appendGoalEvent } = await goalLedgerPromise;

    fakeGoalLockReturn = [{ id: "g-reg" }];
    fakeMaxSequence = null;
    const now = new Date();
    fakeInsertReturn = {
      id: "ev-reg",
      goalId: "g-reg",
      userId: "u-reg",
      sequence: 1,
      eventType: "note",
      summary: "regression check",
      payload: {},
      createdAt: now,
    };

    await appendGoalEvent({
      goalId: "g-reg",
      userId: "u-reg",
      eventType: "note",
      summary: "regression check",
    });

    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.sequence).toBe(1);
    expect(inserted.sequence).not.toBe(0);
  });

  test("REG-003: createGoal inserts a nanoid-length id (not empty, not a fixed stub)", async () => {
    // Catches any regression that replaces nanoid() with a constant or empty string.
    const { createGoal } = await goalLedgerPromise;

    const now = new Date();
    fakeInsertReturn = {
      id: "irrelevant",
      userId: "u-reg",
      objective: "regression check goal",
      status: "draft",
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    await createGoal({ userId: "u-reg", objective: "regression check goal" });

    const inserted = lastInsertValues as Record<string, unknown>;
    const id = inserted.id as string;
    // nanoid() default length is 21 characters
    expect(id.length).toBeGreaterThanOrEqual(10);
    expect(id).not.toBe("irrelevant"); // must be freshly generated, not the fakeReturn value
  });

  test("REG-004: closeGoal passes updatedAt as a fresh Date to the update chain", async () => {
    // If updatedAt is accidentally dropped from the update set, downstream
    // consumers can no longer detect that a goal was closed.
    const { closeGoal } = await goalLedgerPromise;

    const beforeCall = new Date();
    const now = new Date();
    fakeUpdateReturn = {
      id: "g-reg",
      userId: "u-reg",
      objective: "done",
      status: "failed",
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    };

    await closeGoal("g-reg", "failed");

    const updated = lastUpdateValues as Record<string, unknown>;
    expect(updated.updatedAt).toBeInstanceOf(Date);
    // The Date must be at or after the time the call was made
    expect((updated.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(
      beforeCall.getTime(),
    );
  });

  test("REG-005: GoalLedgerError code union includes not_found and persist_failed", async () => {
    // If the code union is narrowed back (removing not_found or persist_failed),
    // constructing errors with those codes would fail TypeScript — this test
    // provides a runtime backstop.
    const { GoalLedgerError } = await goalLedgerPromise;

    const notFound = new GoalLedgerError("not_found", "test not found");
    expect(notFound.code).toBe("not_found");
    expect(notFound.name).toBe("GoalLedgerError");

    const persistFailed = new GoalLedgerError(
      "persist_failed",
      "test persist failed",
    );
    expect(persistFailed.code).toBe("persist_failed");
    expect(persistFailed.name).toBe("GoalLedgerError");
  });

  test("REG-006: listGoals({}) always throws invalid_input — never returns all rows", async () => {
    // Regression guard for the multi-tenant exposure fix. Even if future
    // refactoring accidentally removes the filter guard, this test will catch it.
    const { listGoals, GoalLedgerError } = await goalLedgerPromise;

    // Set up fake rows so a "return all" bug would succeed silently
    fakeSelectRows = [
      { id: "g1", userId: "user-A" },
      { id: "g2", userId: "user-B" },
    ];

    const err = await listGoals({}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "invalid_input",
    );
  });

  test("REG-007: closeGoal not_found message includes the goalId for debuggability", async () => {
    // If the not_found throw is reverted or the message is blanked, a caller
    // receiving a 500 will have no idea which goal was missing. This test pins
    // the message contract.
    const { closeGoal, GoalLedgerError } = await goalLedgerPromise;

    fakeUpdateReturn = null;

    const err = await closeGoal("ghost-goal-id", "complete").catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "not_found",
    );
    expect((err as Error).message).toContain("ghost-goal-id");
  });

  test("REG-008: appendGoalEvent not_found message includes the goalId for debuggability", async () => {
    // If the parent-goal existence check is reverted, calling appendGoalEvent
    // with a missing goalId would silently insert an orphan event row (violating
    // FK in production or returning undefined in tests). This test catches that.
    const { appendGoalEvent, GoalLedgerError } = await goalLedgerPromise;

    fakeGoalLockReturn = []; // no parent goal

    const err = await appendGoalEvent({
      goalId: "orphan-goal-id",
      userId: "user-1",
      eventType: "note",
      summary: "Should be rejected",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "not_found",
    );
    expect((err as Error).message).toContain("orphan-goal-id");
  });

  test("REG-009: createGoal persist_failed is thrown, not swallowed, on empty insert return", async () => {
    // If the undefined-return guard in createGoal is removed, the returned
    // WorkflowGoal will be undefined at runtime — dereferencing it causes a 500.
    // This test verifies the guard throws before returning.
    const { createGoal, GoalLedgerError } = await goalLedgerPromise;

    fakeInsertReturn = null;

    const err = await createGoal({
      userId: "user-x",
      objective: "guard test",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GoalLedgerError);
    expect((err as InstanceType<typeof GoalLedgerError>).code).toBe(
      "persist_failed",
    );
    // Must not resolve to undefined
    expect(err).not.toBeUndefined();
  });
});
