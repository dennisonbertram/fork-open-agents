/**
 * TDD tests for #750 scheduling reliability — store-level behavior.
 *
 * BT-750-A: createBackgroundAgent seeds nextRunAt for a schedule.cron trigger
 *   using computeNextRuns(schedule, now, 1)[0].
 * BT-750-B: updateBackgroundAgent seeds nextRunAt for a newly-added/replaced
 *   schedule.cron trigger.
 * BT-750-C: updateBackgroundAgent preserves trigger identity (id) and schedule
 *   state (lastRunAt/nextRunAt/lastSkipReason) when the trigger's
 *   kind/schedule/conditions/name are unchanged — no delete+recreate.
 * BT-750-D: updateBackgroundAgent still replaces a trigger whose schedule
 *   changed (new identity, freshly seeded nextRunAt).
 *
 * These tests mock only @/lib/db/client (and @/lib/db/schema table symbols) so
 * the real store.ts logic runs against an in-memory fake transaction. No live
 * database or network is used.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── In-memory fake tables ---------------------------------------------------

type FakeAgentRow = Record<string, unknown> & { id: string };
type FakeTriggerRow = Record<string, unknown> & { id: string };

let agentsTable: FakeAgentRow[] = [];
let triggersTable: FakeTriggerRow[] = [];
let idCounter = 0;

mock.module("nanoid", () => ({
  nanoid: (size?: number) => {
    idCounter += 1;
    return size ? `id-${idCounter}-${size}` : `id-${idCounter}`;
  },
}));

const agentsTableSymbol = Symbol("backgroundAgents");
const triggersTableSymbol = Symbol("backgroundAgentTriggers");

mock.module("@/lib/db/schema", () => ({
  backgroundAgents: agentsTableSymbol,
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
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: { strings: Array.from(strings), values },
    }),
    { raw: (s: string) => ({ _sqlRaw: s }) },
  ),
}));

function makeTx() {
  return {
    insert: (table: unknown) => ({
      values: (vals: FakeAgentRow | FakeAgentRow[]) => ({
        returning: () => {
          const rows = Array.isArray(vals) ? vals : [vals];
          if (table === agentsTableSymbol) {
            agentsTable.push(...(rows as FakeAgentRow[]));
          } else if (table === triggersTableSymbol) {
            triggersTable.push(...(rows as FakeTriggerRow[]));
          }
          return rows;
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (setVals: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (table === agentsTableSymbol) {
              const idx = agentsTable.findIndex(
                (row) => row.id === agentsTable[0]?.id,
              );
              if (idx >= 0) {
                agentsTable[idx] = { ...agentsTable[idx], ...setVals };
                return [agentsTable[idx]];
              }
              return [];
            }
            return [];
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: { _eq?: [unknown, unknown] }) => {
        if (table === triggersTableSymbol) {
          const agentId = cond?._eq?.[1];
          triggersTable = triggersTable.filter(
            (row) => row.agentId !== agentId,
          );
        }
        return Promise.resolve();
      },
    }),
    query: {
      backgroundAgents: {
        findFirst: async () => agentsTable[0] ?? undefined,
      },
      backgroundAgentTriggers: {
        findMany: async (opts: {
          where?: { _eq?: [unknown, unknown] };
        }) => {
          const agentId = opts?.where?._eq?.[1];
          return triggersTable.filter((row) => row.agentId === agentId);
        },
      },
    },
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    // Top-level db.update — used by advanceTriggerScheduleState /
    // recordTriggerSkipReason, which operate outside the create/update
    // transaction (e.g. called directly by the dispatcher).
    update: (table: unknown) => ({
      set: (setVals: Record<string, unknown>) => ({
        where: (cond: { _eq?: [unknown, unknown] }) => {
          if (table === triggersTableSymbol) {
            const triggerId = cond?._eq?.[1];
            const idx = triggersTable.findIndex(
              (row) => row.id === triggerId,
            );
            if (idx >= 0) {
              triggersTable[idx] = { ...triggersTable[idx], ...setVals };
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => unknown) =>
      fn(makeTx()),
  },
}));

const storePromise = import("./store");

function resetFixtures() {
  idCounter = 0;
  agentsTable = [];
  triggersTable = [];
}

const baseCreateInput = {
  name: "Nightly digest",
  description: null,
  status: "enabled" as const,
  repoOwner: "acme",
  repoName: "widgets",
  instructions: "Summarize overnight activity.",
  permissions: {},
  outputMode: "none" as const,
  checkCommand: null,
  composioToolkitSlugs: [],
};

describe("#750 store scheduling: seeding on create", () => {
  beforeEach(resetFixtures);

  test("BT-750-A: createBackgroundAgent seeds nextRunAt for a schedule.cron trigger", async () => {
    const { createBackgroundAgent } = await storePromise;
    const now = new Date("2026-06-01T09:12:00.000Z");

    const agent = await createBackgroundAgent(
      "user-1",
      {
        ...baseCreateInput,
        triggers: [
          {
            name: "Nightly",
            kind: "schedule.cron",
            status: "enabled",
            conditions: {},
            schedule: "7 * * * *",
          },
        ],
      },
      { now },
    );

    expect(agent.triggers).toHaveLength(1);
    const trigger = agent.triggers[0];
    expect(trigger?.nextRunAt).toBeInstanceOf(Date);
    // computeNextRuns("7 * * * *", 09:12, 1) → 10:07 same day
    expect(trigger?.nextRunAt?.toISOString()).toBe(
      "2026-06-01T10:07:00.000Z",
    );
  });

  test("BT-750-A: createBackgroundAgent leaves nextRunAt null for non-schedule triggers", async () => {
    const { createBackgroundAgent } = await storePromise;

    const agent = await createBackgroundAgent("user-1", {
      ...baseCreateInput,
      triggers: [
        {
          name: "PR opened",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {},
          schedule: null,
        },
      ],
    });

    expect(agent.triggers[0]?.nextRunAt).toBeNull();
  });
});

describe("#750 store scheduling: seeding + preservation on update", () => {
  beforeEach(resetFixtures);

  test("BT-750-B: updateBackgroundAgent seeds nextRunAt for a new schedule.cron trigger", async () => {
    const { createBackgroundAgent, updateBackgroundAgent } = await storePromise;

    const created = await createBackgroundAgent("user-1", {
      ...baseCreateInput,
      triggers: [
        {
          name: "PR opened",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {},
          schedule: null,
        },
      ],
    });

    const now = new Date("2026-06-01T09:12:00.000Z");
    const updated = await updateBackgroundAgent(
      "user-1",
      created.id,
      {
        triggers: [
          {
            name: "Nightly",
            kind: "schedule.cron",
            status: "enabled",
            conditions: {},
            schedule: "7 * * * *",
          },
        ],
      },
      { now },
    );

    expect(updated?.triggers).toHaveLength(1);
    expect(updated?.triggers[0]?.nextRunAt?.toISOString()).toBe(
      "2026-06-01T10:07:00.000Z",
    );
  });

  test("BT-750-C: updateBackgroundAgent preserves trigger id + schedule state when unchanged", async () => {
    const { createBackgroundAgent, updateBackgroundAgent, advanceTriggerScheduleState } =
      await storePromise;

    const created = await createBackgroundAgent(
      "user-1",
      {
        ...baseCreateInput,
        triggers: [
          {
            name: "Nightly",
            kind: "schedule.cron",
            status: "enabled",
            conditions: {},
            schedule: "7 * * * *",
          },
        ],
      },
      { now: new Date("2026-06-01T09:12:00.000Z") },
    );
    const originalTriggerId = created.triggers[0]?.id;
    expect(originalTriggerId).toBeTruthy();

    // Simulate the dispatcher having advanced schedule state after a real run.
    await advanceTriggerScheduleState({
      triggerId: originalTriggerId as string,
      lastRunAt: new Date("2026-06-01T10:07:00.000Z"),
      nextRunAt: new Date("2026-06-01T11:07:00.000Z"),
    });

    // Edit the agent's instructions but keep the trigger identical
    // (same kind/schedule/conditions/name).
    const updated = await updateBackgroundAgent("user-1", created.id, {
      instructions: "Updated instructions.",
      triggers: [
        {
          name: "Nightly",
          kind: "schedule.cron",
          status: "enabled",
          conditions: {},
          schedule: "7 * * * *",
        },
      ],
    });

    expect(updated?.triggers).toHaveLength(1);
    const preservedTrigger = updated?.triggers[0];
    expect(preservedTrigger?.id).toBe(originalTriggerId as string);
    expect(preservedTrigger?.lastRunAt?.toISOString()).toBe(
      "2026-06-01T10:07:00.000Z",
    );
    expect(preservedTrigger?.nextRunAt?.toISOString()).toBe(
      "2026-06-01T11:07:00.000Z",
    );
  });

  test("BT-750-D: updateBackgroundAgent replaces trigger identity when schedule changes", async () => {
    const { createBackgroundAgent, updateBackgroundAgent, advanceTriggerScheduleState } =
      await storePromise;

    const created = await createBackgroundAgent(
      "user-1",
      {
        ...baseCreateInput,
        triggers: [
          {
            name: "Nightly",
            kind: "schedule.cron",
            status: "enabled",
            conditions: {},
            schedule: "7 * * * *",
          },
        ],
      },
      { now: new Date("2026-06-01T09:12:00.000Z") },
    );
    const originalTriggerId = created.triggers[0]?.id;

    await advanceTriggerScheduleState({
      triggerId: originalTriggerId as string,
      lastRunAt: new Date("2026-06-01T10:07:00.000Z"),
      nextRunAt: new Date("2026-06-01T11:07:00.000Z"),
    });

    const updated = await updateBackgroundAgent(
      "user-1",
      created.id,
      {
        triggers: [
          {
            name: "Nightly",
            kind: "schedule.cron",
            status: "enabled",
            conditions: {},
            schedule: "0 9 * * *",
          },
        ],
      },
      { now: new Date("2026-06-01T09:12:00.000Z") },
    );

    expect(updated?.triggers).toHaveLength(1);
    const replacedTrigger = updated?.triggers[0];
    // A changed schedule means a new trigger identity, and schedule state is
    // freshly seeded (not carried over from the stale schedule's state).
    expect(replacedTrigger?.id).not.toBe(originalTriggerId as string);
    expect(replacedTrigger?.lastRunAt).toBeNull();
    expect(replacedTrigger?.nextRunAt?.toISOString()).toBe(
      "2026-06-01T10:00:00.000Z",
    );
  });
});
