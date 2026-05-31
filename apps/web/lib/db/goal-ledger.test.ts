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

// ---------------------------------------------------------------------------
// Fluent fake-db builder
// ---------------------------------------------------------------------------

/**
 * Build a fake-db object whose every fluent chain captures arguments and
 * returns deterministic test data. The shape mirrors the Drizzle query-builder
 * API used by goal-ledger.ts.
 *
 * Design note on the select chain:
 *   appendGoalEvent does:  await db.select({maxSeq:max(...)}).from(t).where(c)
 *   listGoal* do:          await db.select().from(t).where(c).orderBy(asc(...))
 *                      or  await db.select().from(t).orderBy(asc(...))
 *
 * We distinguish the two uses by what follows the .from() call: if .where()
 * is called next and its result is directly awaited (no .orderBy()), that is
 * the max-sequence path; if .orderBy() follows, that is the list path.
 */
function buildFakeDb() {
  return {
    // ---- select() chain -------------------------------------------------
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        // .where() → returned value is immediately awaited (max-sequence path)
        // OR chained with .orderBy() (list path after .where())
        where: (_cond: unknown) => {
          // Return a Promise-like object that supports being directly awaited
          // AND supports an optional .orderBy() chain.
          // We use an object that is itself a Promise so there is no
          // custom-thenable lint trigger — the object wraps a real Promise.
          const basePromise = Promise.resolve([
            { maxSeq: fakeMaxSequence },
          ] as unknown[]);

          return Object.assign(basePromise, {
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
    transaction: async <T>(
      callback: (tx: ReturnType<typeof buildFakeDb>) => Promise<T>,
    ) => callback(buildFakeDb()),
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

  test("BT-001d: throws InvalidGoalInputError when objective is missing or empty", async () => {
    const { createGoal, InvalidGoalInputError } = await goalLedgerPromise;

    const err = await createGoal({
      userId: "user-1",
      objective: "",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidGoalInputError);
    expect((err as Error).message).toContain("objective");
  });
});

// ---------------------------------------------------------------------------
// BT-002: appendGoalEvent — sequence computation
// ---------------------------------------------------------------------------
describe("appendGoalEvent", () => {
  test("BT-002a: uses sequence 1 when no prior events exist (max returns null)", async () => {
    const { appendGoalEvent } = await goalLedgerPromise;

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

  test("BT-005b: throws GoalLedgerError with 'terminal' in message for non-terminal status", async () => {
    const { closeGoal, NonTerminalStatusError } = await goalLedgerPromise;

    const err = await closeGoal("goal-1", "running" as never).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(NonTerminalStatusError);
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
});
