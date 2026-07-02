import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type InsertCall = { values: Record<string, unknown> };
type SelectResult = Array<Record<string, unknown>>;
type InsertResult = Array<Record<string, unknown>>;
type FakeDb = {
  transaction: <T>(callback: (tx: FakeDb) => T) => Promise<T>;
  select: (_columns?: unknown) => {
    from: (_table: unknown) => {
      where: (_condition: unknown) => SelectResult;
    };
  };
  insert: (_table: unknown) => {
    values: (_values: Record<string, unknown>) => {
      returning: () => Promise<InsertResult>;
    };
  };
};

const insertCalls: InsertCall[] = [];
let selectResults: SelectResult[] = [];
let insertResults: InsertResult[] = [];
let transactionCount = 0;

function buildFakeDb(): FakeDb {
  return {
    transaction: async <T>(callback: (tx: FakeDb) => T) => {
      transactionCount += 1;
      return callback(buildFakeDb());
    },
    select: () => ({
      from: () => ({
        where: () => selectResults.shift() ?? [],
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ values });
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
  selectResults = [];
  insertResults = [];
  transactionCount = 0;
});

describe("GTM research store", () => {
  test("persists a completed research run with draft signal candidates and events", async () => {
    const { createGtmResearchRun } = await storePromise;
    selectResults = [[{ id: "account-1" }]];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "started-event" }],
      [{ id: "signal-1" }],
      [{ id: "signal-event" }],
      [{ id: "completed-event" }],
    ];

    const result = await createGtmResearchRun(
      {
        userId: "user-1",
        requestId: "req-1",
        accountId: "account-1",
        claims: [
          {
            text: "Acme has a pain around approval-safe agents",
            evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
          },
        ],
      },
      fakeDatabase(),
    );

    expect(transactionCount).toBe(1);
    expect(result.signalIds).toEqual(["signal-1"]);
    expect(
      insertCalls.map((call) => call.values.eventName).filter(Boolean),
    ).toEqual([
      "gtm.agent_run.started",
      "gtm.signal.recorded",
      "gtm.agent_run.completed",
    ]);
    expect(
      insertCalls.find((call) => call.values.kind === "pain")?.values,
    ).toMatchObject({
      status: "draft",
      accountId: "account-1",
      userId: "user-1",
    });
  });

  test("rejects account references outside the caller scope before inserts", async () => {
    const { createGtmResearchRun } = await storePromise;
    selectResults = [[]];

    await expect(
      createGtmResearchRun(
        {
          userId: "user-1",
          requestId: "req-1",
          accountId: "foreign-account",
          claims: [],
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "cross_user_reference" });

    expect(insertCalls).toHaveLength(0);
  });
});
