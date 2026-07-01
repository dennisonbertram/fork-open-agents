/**
 * Regression pinning tests for fix #326: loop-bound triggers are NOT filtered
 * out by agentId innerJoins in store queries.
 *
 * These tests pin the final behavior contract as observed after the fix and will
 * catch any future regression where innerJoin is re-introduced for the agents
 * join in listMatchingTriggersForEvent, listEnabledScheduleTriggers, or
 * getWebhookTriggerByPublicId.
 *
 * REGRESSION-326-STORE: loop-bound trigger rows (agentId=null) survive all three
 * store query functions when a leftJoin is used instead of innerJoin.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB chain mock (same pattern as loop-trigger-store-matching.test.ts) ─────────

const joinCallLog: Array<{ method: "leftJoin" | "innerJoin"; table: unknown }> =
  [];

let queryRows: unknown[] = [];

function makeWhereResult(): Promise<unknown[]> & {
  limit: (_n?: unknown) => Promise<unknown[]>;
} {
  const rows = queryRows;
  const p = Promise.resolve(rows);
  return Object.assign(p, {
    limit: (_n?: unknown) => Promise.resolve(rows.slice(0, 1)),
  });
}

function makeJoinChain(): Record<string, unknown> {
  return {
    leftJoin: mock((table: unknown, _cond?: unknown) => {
      joinCallLog.push({ method: "leftJoin", table });
      return makeJoinChain();
    }),
    innerJoin: mock((table: unknown, _cond?: unknown) => {
      joinCallLog.push({ method: "innerJoin", table });
      return makeJoinChain();
    }),
    where: mock((_cond?: unknown) => makeWhereResult()),
    limit: mock((_n?: unknown) => Promise.resolve(queryRows.slice(0, 1))),
  };
}

function makeFromChain() {
  return {
    leftJoin: mock((table: unknown, _cond?: unknown) => {
      joinCallLog.push({ method: "leftJoin", table });
      return makeJoinChain();
    }),
    innerJoin: mock((table: unknown, _cond?: unknown) => {
      joinCallLog.push({ method: "innerJoin", table });
      return makeJoinChain();
    }),
    where: mock((_cond?: unknown) => makeWhereResult()),
    limit: mock((_n?: unknown) => Promise.resolve(queryRows.slice(0, 1))),
  };
}

const fromMock = mock((_table: unknown) => makeFromChain());
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));
const findManyMock = mock(async () => queryRows as unknown[]);
const findFirstMock = mock(async () => (queryRows[0] ?? null) as unknown);

mock.module("@/lib/db/client", () => ({
  db: {
    select: selectMock,
    insert: mock(() => ({
      values: mock(() => ({ returning: mock(() => []) })),
    })),
    update: mock(() => ({
      set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })),
    })),
    query: {
      backgroundAgents: { findMany: findManyMock, findFirst: findFirstMock },
      backgroundAgentTriggers: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      backgroundAgentRuns: { findMany: findManyMock, findFirst: findFirstMock },
      backgroundAgentEvents: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
      backgroundAgentOutputs: {
        findMany: findManyMock,
        findFirst: findFirstMock,
      },
    },
  },
}));

mock.module("@/lib/db/schema", () => ({
  backgroundAgents: Symbol("backgroundAgents"),
  backgroundAgentTriggers: Symbol("backgroundAgentTriggers"),
  agentLoops: Symbol("agentLoops"),
  backgroundAgentRuns: Symbol("backgroundAgentRuns"),
  backgroundAgentEvents: Symbol("backgroundAgentEvents"),
  backgroundAgentOutputs: Symbol("backgroundAgentOutputs"),
  backgroundAgentToolGrants: Symbol("backgroundAgentToolGrants"),
}));

mock.module("drizzle-orm", () => ({
  and: mock((...args: unknown[]) => ({ _and: args })),
  or: mock((...args: unknown[]) => ({ _or: args })),
  eq: mock((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  isNotNull: mock((a: unknown) => ({ _isNotNull: a })),
  isNull: mock((a: unknown) => ({ _isNull: a })),
  desc: mock((a: unknown) => ({ _desc: a })),
  inArray: mock((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
  notInArray: mock((a: unknown, b: unknown) => ({ _notInArray: [a, b] })),
  sql: Object.assign(
    mock((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: { strings: Array.from(strings), values },
    })),
    { raw: mock((s: string) => ({ _sqlRaw: s })) },
  ),
}));

const storePromise = import("./store");

function resetMocks() {
  joinCallLog.length = 0;
  queryRows = [];
  selectMock.mockClear();
  fromMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockClear();
}

// ── REGRESSION-326-STORE-A: listMatchingTriggersForEvent never uses innerJoin ──

describe("REGRESSION-326-STORE-A: listMatchingTriggersForEvent join shape", () => {
  beforeEach(resetMocks);

  test("innerJoin is NEVER called — loop-bound triggers (agentId=null) are not filtered out", async () => {
    const { listMatchingTriggersForEvent } = await storePromise;
    await listMatchingTriggersForEvent({
      source: "github",
      kind: "github.pull_request",
      externalId: "reg-delivery-1",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
    });

    const innerJoins = joinCallLog.filter((c) => c.method === "innerJoin");
    // REGRESSION PIN: if innerJoin is re-introduced here, loop triggers break.
    expect(innerJoins).toHaveLength(0);
    // Both leftJoins must be present: one for backgroundAgents, one for agentLoops.
    const leftJoins = joinCallLog.filter((c) => c.method === "leftJoin");
    expect(leftJoins.length).toBeGreaterThanOrEqual(2);
  });

  test("null-agent row (loop trigger) is returned, not dropped by filter", async () => {
    const { listMatchingTriggersForEvent } = await storePromise;
    queryRows = [
      {
        trigger: {
          id: "t-loop-reg",
          agentId: null,
          loopId: "loop-reg-1",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {},
          schedule: null,
          userId: "user-1",
          name: "Regression loop trigger",
          webhookPublicId: null,
          webhookSecretHash: null,
          lastRunAt: null,
          nextRunAt: null,
          lastSkipReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        agent: null,
      },
    ];

    const results = await listMatchingTriggersForEvent({
      source: "github",
      kind: "github.pull_request",
      externalId: "reg-delivery-2",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
    });

    // REGRESSION PIN: null-agent row must survive — it was previously dropped by
    // the innerJoin contract (NULL never matches an inner join condition).
    expect(results.length).toBe(1);
    expect(results[0]?.agent).toBeNull();
    expect(results[0]?.trigger.loopId).toBe("loop-reg-1");
  });
});

// ── REGRESSION-326-STORE-B: listEnabledScheduleTriggers never uses innerJoin ──

describe("REGRESSION-326-STORE-B: listEnabledScheduleTriggers join shape", () => {
  beforeEach(resetMocks);

  test("innerJoin is NEVER called — loop cron triggers are not filtered out", async () => {
    const { listEnabledScheduleTriggers } = await storePromise;
    await listEnabledScheduleTriggers();

    const innerJoins = joinCallLog.filter((c) => c.method === "innerJoin");
    expect(innerJoins).toHaveLength(0);
    const leftJoins = joinCallLog.filter((c) => c.method === "leftJoin");
    expect(leftJoins.length).toBeGreaterThanOrEqual(2);
  });

  test("loop cron trigger row (agent: null) is included in results", async () => {
    const { listEnabledScheduleTriggers } = await storePromise;
    queryRows = [
      {
        trigger: {
          id: "t-cron-loop-reg",
          agentId: null,
          loopId: "loop-cron-reg-1",
          kind: "schedule.cron",
          status: "enabled",
          schedule: "*/5 * * * *",
          conditions: {},
          userId: "user-1",
          name: "Regression cron loop trigger",
          webhookPublicId: null,
          webhookSecretHash: null,
          lastRunAt: null,
          nextRunAt: null,
          lastSkipReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        agent: null,
      },
    ];

    const results = await listEnabledScheduleTriggers();
    expect(results.length).toBe(1);
    expect(results[0]?.agent).toBeNull();
    expect(results[0]?.trigger.loopId).toBe("loop-cron-reg-1");
  });
});

// ── REGRESSION-326-STORE-C: getWebhookTriggerByPublicId never uses innerJoin ──

describe("REGRESSION-326-STORE-C: getWebhookTriggerByPublicId join shape", () => {
  beforeEach(resetMocks);

  test("innerJoin is NEVER called — loop webhook triggers are not filtered out", async () => {
    const { getWebhookTriggerByPublicId } = await storePromise;
    queryRows = [];
    await getWebhookTriggerByPublicId("wh_regression_1");

    const innerJoins = joinCallLog.filter((c) => c.method === "innerJoin");
    expect(innerJoins).toHaveLength(0);
    const leftJoins = joinCallLog.filter((c) => c.method === "leftJoin");
    expect(leftJoins.length).toBeGreaterThanOrEqual(2);
  });

  test("loop webhook trigger row (agent: null) is returned correctly", async () => {
    const { getWebhookTriggerByPublicId } = await storePromise;
    queryRows = [
      {
        trigger: {
          id: "t-webhook-loop-reg",
          agentId: null,
          loopId: "loop-webhook-reg-1",
          kind: "webhook.error",
          status: "enabled",
          webhookPublicId: "wh_regression_1",
          webhookSecretHash: "hash-reg",
          conditions: {},
          schedule: null,
          userId: "user-1",
          name: "Regression webhook loop trigger",
          lastRunAt: null,
          nextRunAt: null,
          lastSkipReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        agent: null,
      },
    ];

    const result = await getWebhookTriggerByPublicId("wh_regression_1");
    // REGRESSION PIN: null-agent row must be returned — innerJoin would have
    // dropped it (NULL != innerJoin condition).
    expect(result).not.toBeNull();
    expect(result?.agent).toBeNull();
    expect(result?.trigger.loopId).toBe("loop-webhook-reg-1");
  });
});
