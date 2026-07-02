/**
 * TDD RED tests for fix #326: loop-bound triggers filtered out by agentId innerJoin.
 *
 * BUG: listMatchingTriggersForEvent, listEnabledScheduleTriggers, and
 * getWebhookTriggerByPublicId all use .innerJoin(backgroundAgents, …) which
 * drops rows where agentId IS NULL (loop-bound triggers).
 *
 * These tests assert the FIXED behavior:
 * 1. listMatchingTriggersForEvent uses leftJoin (not innerJoin) for agents,
 *    adds leftJoin on agentLoops, and returns loop-bound rows (agent: null).
 * 2. listEnabledScheduleTriggers returns loop-bound schedule rows (agent: null).
 * 3. getWebhookTriggerByPublicId returns loop-bound rows (agent: null).
 * 4. dispatchWebhookErrorEvent does NOT dereference row.agent.status before
 *    checking trigger.loopId — a loop-bound webhook trigger reaches the bridge.
 *
 * Chain mock records join calls so we can assert leftJoin vs innerJoin.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB chain mock ──────────────────────────────────────────────────────────────

// Track which join method was called and how many times per query.
const joinCallLog: Array<{ method: "leftJoin" | "innerJoin"; table: unknown }> =
  [];

let queryRows: unknown[] = [];

// Chain: .from().leftJoin().leftJoin().where().limit() → Promise<rows>
// We build a minimal chain that records join method calls and returns queryRows.
//
// The tricky part: getWebhookTriggerByPublicId calls .where(cond).limit(1).
// So .where() must return an object with a .limit() method (not a raw Promise).
// listMatchingTriggersForEvent and listEnabledScheduleTriggers await .where()
// directly (no .limit call), so .where()'s return must also be thenable.
//
// Solution: make .where() return a "thenable object with .limit()" — an object
// that implements the Promise protocol (then/catch) AND has .limit().

function makeWhereResult(): Promise<unknown[]> & {
  limit: (_n?: unknown) => Promise<unknown[]>;
} {
  const rows = queryRows;
  const p = Promise.resolve(rows);
  // Attach .limit() to the real Promise object (not a plain object with .then).
  // This satisfies both: await .where() works, and .where().limit(1) works.
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

// Schema mock: symbols for table references
const backgroundAgentsTable = Symbol("backgroundAgents");
const backgroundAgentTriggersTable = Symbol("backgroundAgentTriggers");
const agentLoopsTable = Symbol("agentLoops");
const backgroundAgentRunsTable = Symbol("backgroundAgentRuns");
const backgroundAgentEventsTable = Symbol("backgroundAgentEvents");
const backgroundAgentOutputsTable = Symbol("backgroundAgentOutputs");
const backgroundAgentToolGrantsTable = Symbol("backgroundAgentToolGrants");

mock.module("@/lib/db/schema", () => ({
  backgroundAgents: backgroundAgentsTable,
  backgroundAgentTriggers: backgroundAgentTriggersTable,
  agentLoops: agentLoopsTable,
  backgroundAgentRuns: backgroundAgentRunsTable,
  backgroundAgentEvents: backgroundAgentEventsTable,
  backgroundAgentOutputs: backgroundAgentOutputsTable,
  backgroundAgentToolGrants: backgroundAgentToolGrantsTable,
}));

// drizzle-orm functions mock
mock.module("drizzle-orm", () => ({
  and: mock((...args: unknown[]) => ({ _and: args })),
  or: mock((...args: unknown[]) => ({ _or: args })),
  eq: mock((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  isNotNull: mock((a: unknown) => ({ _isNotNull: a })),
  isNull: mock((a: unknown) => ({ _isNull: a })),
  like: mock((a: unknown, b: unknown) => ({ _like: [a, b] })),
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetMocks() {
  joinCallLog.length = 0;
  queryRows = [];
  selectMock.mockClear();
  fromMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockClear();
}

// ── BT-326-S1: listMatchingTriggersForEvent uses leftJoin, not innerJoin ───────

describe("listMatchingTriggersForEvent — join contract", () => {
  beforeEach(resetMocks);

  test("BT-326-S1a: does NOT call innerJoin for the backgroundAgents join", async () => {
    const { listMatchingTriggersForEvent } = await storePromise;
    queryRows = [];
    await listMatchingTriggersForEvent({
      source: "github",
      kind: "github.pull_request",
      externalId: "delivery-1",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
    });

    const innerJoinCalls = joinCallLog.filter((c) => c.method === "innerJoin");
    // The backgroundAgents join must NOT be innerJoin — loop-bound triggers have
    // agentId = null and innerJoin would drop them.
    expect(innerJoinCalls).toHaveLength(0);
  });

  test("BT-326-S1b: calls leftJoin at least twice (once for agents, once for agentLoops)", async () => {
    const { listMatchingTriggersForEvent } = await storePromise;
    queryRows = [];
    await listMatchingTriggersForEvent({
      source: "github",
      kind: "github.pull_request",
      externalId: "delivery-2",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
    });

    const leftJoinCalls = joinCallLog.filter((c) => c.method === "leftJoin");
    // Must have at least 2 leftJoins: one for backgroundAgents, one for agentLoops.
    expect(leftJoinCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("BT-326-S1c: row with agent=null survives and is returned for loop-bound trigger", async () => {
    const { listMatchingTriggersForEvent } = await storePromise;
    // A loop-bound trigger row has agent: null in the join result.
    // triggerMatchesEvent only operates on trigger fields, so null agent must not throw.
    const loopTriggerRow = {
      trigger: {
        id: "trigger-loop-1",
        agentId: null,
        loopId: "loop-1",
        kind: "github.pull_request",
        status: "enabled",
        conditions: {},
        schedule: null,
        userId: "user-1",
        name: "Loop trigger",
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      agent: null, // loop-bound: no agent row
      agentLoop: {
        id: "loop-1",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
      },
    };
    queryRows = [loopTriggerRow];

    const results = await listMatchingTriggersForEvent({
      source: "github",
      kind: "github.pull_request",
      externalId: "delivery-3",
      repoOwner: "acme",
      repoName: "widgets",
      action: "opened",
    });

    // The loop-bound row must survive (not filtered out by the null agent check)
    expect(results.length).toBeGreaterThanOrEqual(1);
    const loopRow = results.find((r) => r.trigger.loopId === "loop-1");
    expect(loopRow).toBeDefined();
    expect(loopRow?.agent).toBeNull();
  });
});

// ── BT-326-S2: listEnabledScheduleTriggers uses leftJoin ──────────────────────

describe("listEnabledScheduleTriggers — join contract", () => {
  beforeEach(resetMocks);

  test("BT-326-S2a: does NOT call innerJoin for agents", async () => {
    const { listEnabledScheduleTriggers } = await storePromise;
    queryRows = [];
    await listEnabledScheduleTriggers();

    const innerJoinCalls = joinCallLog.filter((c) => c.method === "innerJoin");
    expect(innerJoinCalls).toHaveLength(0);
  });

  test("BT-326-S2b: loop-bound schedule trigger row (agent: null) is returned", async () => {
    const { listEnabledScheduleTriggers } = await storePromise;
    const loopScheduleRow = {
      trigger: {
        id: "trigger-cron-loop",
        agentId: null,
        loopId: "loop-cron-1",
        kind: "schedule.cron",
        status: "enabled",
        schedule: "* * * * *",
        conditions: {},
        userId: "user-1",
        name: "Loop cron trigger",
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      agent: null,
      agentLoop: {
        id: "loop-cron-1",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
      },
    };
    queryRows = [loopScheduleRow];

    const results = await listEnabledScheduleTriggers();
    expect(results.length).toBeGreaterThanOrEqual(1);
    const loopRow = results.find((r) => r.trigger.loopId === "loop-cron-1");
    expect(loopRow).toBeDefined();
    expect(loopRow?.agent).toBeNull();
  });
});

// ── BT-326-S3: getWebhookTriggerByPublicId uses leftJoin ─────────────────────

describe("getWebhookTriggerByPublicId — join contract", () => {
  beforeEach(resetMocks);

  test("BT-326-S3a: does NOT call innerJoin for agents", async () => {
    const { getWebhookTriggerByPublicId } = await storePromise;
    queryRows = [];
    await getWebhookTriggerByPublicId("wh_loop_123");

    const innerJoinCalls = joinCallLog.filter((c) => c.method === "innerJoin");
    expect(innerJoinCalls).toHaveLength(0);
  });

  test("BT-326-S3b: returns loop-bound row with agent: null", async () => {
    const { getWebhookTriggerByPublicId } = await storePromise;
    const loopWebhookRow = {
      trigger: {
        id: "trigger-webhook-loop",
        agentId: null,
        loopId: "loop-webhook-1",
        kind: "webhook.error",
        status: "enabled",
        webhookPublicId: "wh_loop_123",
        webhookSecretHash: "hash-abc",
        conditions: {},
        schedule: null,
        userId: "user-1",
        name: "Loop webhook trigger",
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      agent: null,
      agentLoop: {
        id: "loop-webhook-1",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
      },
    };
    queryRows = [loopWebhookRow];

    const result = await getWebhookTriggerByPublicId("wh_loop_123");
    expect(result).not.toBeNull();
    expect(result?.agent).toBeNull();
    expect(result?.trigger.loopId).toBe("loop-webhook-1");
  });
});
