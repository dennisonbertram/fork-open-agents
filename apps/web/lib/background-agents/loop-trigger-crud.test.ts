/**
 * TDD RED tests for #762 — loop-bound trigger CRUD store functions.
 *
 * createLoopTrigger / updateLoopTrigger / deleteLoopTrigger / getOwnedLoopTrigger
 * insert/update/delete rows in background_agent_triggers with loopId set and
 * agentId null (the DB CHECK num_nonnulls(agent_id, loop_id) = 1 is enforced by
 * Postgres — these store-level tests only assert the values passed to insert
 * satisfy the same shape).
 *
 * BT-762-S1: createLoopTrigger inserts a row with loopId set, agentId null.
 * BT-762-S2: createLoopTrigger seeds nextRunAt for schedule.cron triggers.
 * BT-762-S3: createLoopTrigger does NOT seed nextRunAt for event triggers.
 * BT-762-S4: updateLoopTrigger only updates a trigger scoped to (id, loopId).
 * BT-762-S5: updateLoopTrigger re-seeds nextRunAt when the schedule changes.
 * BT-762-S6: deleteLoopTrigger deletes scoped to (id, loopId) and reports success.
 * BT-762-S7: getOwnedLoopTrigger returns null when the trigger belongs to a
 *            different loop (ownership check happens at the loop level).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type FakeTriggerRow = Record<string, unknown> & { id: string };

let triggersTable: FakeTriggerRow[] = [];
let idCounter = 0;

mock.module("nanoid", () => ({
  nanoid: (size?: number) => {
    idCounter += 1;
    return size ? `id-${idCounter}-${size}` : `id-${idCounter}`;
  },
}));

const triggersTableSymbol = Symbol("backgroundAgentTriggers");

mock.module("@/lib/db/schema", () => ({
  backgroundAgents: Symbol("backgroundAgents"),
  backgroundAgentTriggers: triggersTableSymbol,
  agentLoops: Symbol("agentLoops"),
  backgroundAgentRuns: Symbol("backgroundAgentRuns"),
  backgroundAgentEvents: Symbol("backgroundAgentEvents"),
  backgroundAgentOutputs: Symbol("backgroundAgentOutputs"),
  backgroundAgentToolGrants: Symbol("backgroundAgentToolGrants"),
}));

mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  isNotNull: (a: unknown) => ({ _isNotNull: a }),
  isNull: (a: unknown) => ({ _isNull: a }),
  desc: (a: unknown) => ({ _desc: a }),
  inArray: (a: unknown, b: unknown) => ({ _inArray: [a, b] }),
  notInArray: (a: unknown, b: unknown) => ({ _notInArray: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: { strings: Array.from(strings), values },
    }),
    { raw: (s: string) => ({ _sqlRaw: s }) },
  ),
}));

function evalCondition(
  row: FakeTriggerRow,
  cond: Record<string, unknown> | undefined,
): boolean {
  if (!cond) return true;
  if (cond._and) {
    return (cond._and as unknown[]).every((c) =>
      evalCondition(row, c as Record<string, unknown>),
    );
  }
  if (cond._eq) {
    const [field, value] = cond._eq as [unknown, unknown];
    // field is a column reference symbol placeholder in our mock — we can't
    // resolve which column it is, so we match by value against id/loopId.
    return row.id === value || row.loopId === value;
  }
  return true;
}

mock.module("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (vals: FakeTriggerRow | FakeTriggerRow[]) => {
        const rows = Array.isArray(vals) ? vals : [vals];
        if (table === triggersTableSymbol) {
          triggersTable.push(...rows);
        }
        return {
          returning: () => rows,
        };
      },
    }),
    update: (table: unknown) => ({
      set: (setVals: Record<string, unknown>) => ({
        where: (cond: Record<string, unknown>) => ({
          returning: () => {
            if (table !== triggersTableSymbol) return [];
            const matched = triggersTable.filter((row) =>
              evalCondition(row, cond),
            );
            for (const row of matched) {
              Object.assign(row, setVals);
            }
            return matched;
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: Record<string, unknown>) => ({
        returning: () => {
          if (table !== triggersTableSymbol) return [];
          const matched = triggersTable.filter((row) =>
            evalCondition(row, cond),
          );
          triggersTable = triggersTable.filter(
            (row) => !matched.includes(row),
          );
          return matched;
        },
      }),
    }),
    query: {
      backgroundAgentTriggers: {
        findFirst: async (opts: { where?: Record<string, unknown> }) =>
          triggersTable.find((row) => evalCondition(row, opts?.where)) ??
          undefined,
        findMany: async (opts: { where?: Record<string, unknown> }) =>
          triggersTable.filter((row) => evalCondition(row, opts?.where)),
      },
    },
  },
}));

const storePromise = import("./store");

function resetFixtures() {
  idCounter = 0;
  triggersTable = [];
}

describe("createLoopTrigger (#762)", () => {
  beforeEach(resetFixtures);

  test("BT-762-S1: inserts a row with loopId set and agentId null", async () => {
    const { createLoopTrigger } = await storePromise;
    const trigger = await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "PR opened",
        kind: "github.pull_request",
        status: "enabled",
        conditions: { actions: ["opened"] },
        schedule: null,
      },
    });

    expect(trigger.loopId).toBe("loop-1");
    expect(trigger.agentId).toBeNull();
    expect(triggersTable).toHaveLength(1);
    expect(triggersTable[0]?.loopId).toBe("loop-1");
    expect(triggersTable[0]?.agentId).toBeNull();
  });

  test("BT-762-S2: seeds nextRunAt for a schedule.cron trigger", async () => {
    const { createLoopTrigger } = await storePromise;
    const now = new Date("2026-01-01T00:00:00Z");
    const trigger = await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "Nightly",
        kind: "schedule.cron",
        status: "enabled",
        conditions: {},
        schedule: "0 2 * * *",
      },
      now,
    });

    expect(trigger.nextRunAt).not.toBeNull();
    expect(trigger.nextRunAt).toBeInstanceOf(Date);
  });

  test("BT-762-S3: does not seed nextRunAt for an event trigger", async () => {
    const { createLoopTrigger } = await storePromise;
    const trigger = await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "PR opened",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {},
        schedule: null,
      },
    });

    expect(trigger.nextRunAt).toBeNull();
  });
});

describe("updateLoopTrigger (#762)", () => {
  beforeEach(async () => {
    resetFixtures();
    const { createLoopTrigger } = await storePromise;
    await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "Nightly",
        kind: "schedule.cron",
        status: "enabled",
        conditions: {},
        schedule: "0 2 * * *",
      },
    });
  });

  test("BT-762-S4: updates a trigger scoped to (id, loopId)", async () => {
    const { updateLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const updated = await updateLoopTrigger({
      loopId: "loop-1",
      triggerId: existingId,
      input: { status: "disabled" },
    });

    expect(updated?.status).toBe("disabled");
  });

  test("BT-762-S4b: returns null for a trigger scoped to a different loop", async () => {
    const { updateLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const updated = await updateLoopTrigger({
      loopId: "loop-999-not-owner",
      triggerId: existingId,
      input: { status: "disabled" },
    });

    expect(updated).toBeNull();
  });

  test("BT-762-S5: re-seeds nextRunAt when the schedule changes", async () => {
    const { updateLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;
    const originalNextRunAt = triggersTable[0]?.nextRunAt;

    const updated = await updateLoopTrigger({
      loopId: "loop-1",
      triggerId: existingId,
      input: { schedule: "0 9 * * 1-5" },
      now: new Date("2026-02-01T00:00:00Z"),
    });

    expect(updated?.nextRunAt).not.toEqual(originalNextRunAt);
    expect(updated?.nextRunAt).not.toBeNull();
  });
});

describe("deleteLoopTrigger (#762)", () => {
  beforeEach(async () => {
    resetFixtures();
    const { createLoopTrigger } = await storePromise;
    await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "PR opened",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {},
        schedule: null,
      },
    });
  });

  test("BT-762-S6: deletes a trigger scoped to (id, loopId) and reports success", async () => {
    const { deleteLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const deleted = await deleteLoopTrigger({
      loopId: "loop-1",
      triggerId: existingId,
    });

    expect(deleted).toBe(true);
    expect(triggersTable).toHaveLength(0);
  });

  test("BT-762-S6b: returns false for a trigger scoped to a different loop", async () => {
    const { deleteLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const deleted = await deleteLoopTrigger({
      loopId: "loop-999-not-owner",
      triggerId: existingId,
    });

    expect(deleted).toBe(false);
    expect(triggersTable).toHaveLength(1);
  });
});

describe("getOwnedLoopTrigger (#762)", () => {
  beforeEach(async () => {
    resetFixtures();
    const { createLoopTrigger } = await storePromise;
    await createLoopTrigger({
      loopId: "loop-1",
      userId: "user-1",
      input: {
        name: "PR opened",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {},
        schedule: null,
      },
    });
  });

  test("BT-762-S7: returns null when the trigger belongs to a different loop", async () => {
    const { getOwnedLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const found = await getOwnedLoopTrigger({
      loopId: "loop-other",
      triggerId: existingId,
    });

    expect(found).toBeNull();
  });

  test("BT-762-S7b: returns the trigger when it belongs to the given loop", async () => {
    const { getOwnedLoopTrigger } = await storePromise;
    const existingId = triggersTable[0]?.id as string;

    const found = await getOwnedLoopTrigger({
      loopId: "loop-1",
      triggerId: existingId,
    });

    expect(found?.id).toBe(existingId);
  });
});
