import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
};

type SelectResult = Array<Record<string, unknown>>;
type InsertResult = Array<Record<string, unknown>>;
type ChainableSelectResult = SelectResult & {
  orderBy: (_order: unknown) => SelectResult;
};
type FakeDb = {
  transaction: <T>(callback: (tx: FakeDb) => T | Promise<T>) => Promise<T>;
  select: (_columns?: unknown) => {
    from: (_table: unknown) => {
      where: (_condition: unknown) => ChainableSelectResult;
      orderBy: (_order: unknown) => SelectResult;
    };
  };
  insert: (_table: unknown) => {
    values: (_values: Record<string, unknown>) => {
      returning: () => Promise<InsertResult>;
    };
  };
};

const insertCalls: InsertCall[] = [];
let selectCount = 0;
let selectResults: SelectResult[] = [];
let insertResults: InsertResult[] = [];
let transactionCount = 0;

function nextSelectResult(): ChainableSelectResult {
  selectCount += 1;
  const rows = (selectResults.shift() ?? []) as ChainableSelectResult;
  rows.orderBy = () => rows;
  return rows;
}

function buildFakeDb(): FakeDb {
  return {
    transaction: async <T>(callback: (tx: FakeDb) => T | Promise<T>) => {
      transactionCount += 1;
      return callback(buildFakeDb());
    },
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => nextSelectResult(),
        orderBy: (_order: unknown) => nextSelectResult(),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return {
          returning: async () => insertResults.shift() ?? [],
        };
      },
    }),
  };
}

function fakeDatabase() {
  return buildFakeDb() as never;
}

const storePromise = import("./store");

beforeEach(() => {
  insertCalls.length = 0;
  selectCount = 0;
  selectResults = [];
  insertResults = [];
  transactionCount = 0;
});

describe("GTM activation store", () => {
  test("persists private activation signals and issue approvals without filing issues", async () => {
    const { runGtmActivationWatcher } = await storePromise;
    selectResults = [[]];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-scan" }],
      [{ id: "signal-1" }],
      [{ id: "approval-1" }],
      [{ id: "event-signal" }],
    ];

    const result = await runGtmActivationWatcher(
      {
        userId: "operator-1",
        requestId: "req-1",
        candidates: [{ targetUserHash: "user-hash", githubInstalled: false }],
      },
      fakeDatabase(),
    );

    expect(result).toEqual({
      runId: "run-1",
      signalIds: ["signal-1"],
      approvalIds: ["approval-1"],
      dedupedCount: 0,
    });
    expect(transactionCount).toBe(1);
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        runKind: "activation_watcher",
        status: "completed",
      }),
    );
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        kind: "activation",
        status: "draft",
      }),
    );
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        actionKind: "activation_issue_draft_file",
        status: "pending",
      }),
    );
  });

  test("dedupes existing activation signals", async () => {
    const { runGtmActivationWatcher } = await storePromise;
    selectResults = [[{ id: "signal-existing" }]];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-scan" }],
      [{ id: "event-dedupe" }],
    ];

    const result = await runGtmActivationWatcher(
      {
        userId: "operator-1",
        requestId: "req-1",
        candidates: [{ targetUserHash: "user-hash", githubInstalled: false }],
      },
      fakeDatabase(),
    );

    expect(result.signalIds).toEqual([]);
    expect(result.approvalIds).toEqual([]);
    expect(result.dedupedCount).toBe(1);
    expect(insertCalls.map((call) => call.values)).not.toContainEqual(
      expect.objectContaining({ actionKind: "activation_issue_draft_file" }),
    );
  });

  test("lists activation signals with pending approvals in one approval query", async () => {
    const { listGtmActivationSignals } = await storePromise;
    selectResults = [
      [
        {
          signalId: "signal-1",
          signalType: "activation",
          severity: "high",
          summary: "Blocked setup",
          evidenceRefs: ["event-1"],
          metadata: {},
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          signalId: "signal-2",
          signalType: "activation",
          severity: "medium",
          summary: "Confused setup",
          evidenceRefs: ["event-2"],
          metadata: {},
          updatedAt: new Date("2026-07-01T00:01:00.000Z"),
        },
      ],
      [{ id: "approval-1", targetId: "signal-1" }],
    ];

    const queue = await listGtmActivationSignals("operator-1", fakeDatabase());

    expect(queue).toEqual([
      expect.objectContaining({
        signalId: "signal-1",
        approvalId: "approval-1",
      }),
      expect.objectContaining({
        signalId: "signal-2",
      }),
    ]);
    expect(queue[1]).not.toHaveProperty("approvalId");
    expect(selectCount).toBe(2);
  });
});
