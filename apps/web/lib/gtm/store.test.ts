import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
};

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
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => selectResults.shift() ?? [],
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
  selectResults = [];
  insertResults = [];
  transactionCount = 0;
});

describe("GTM store", () => {
  test("creates an account and ledger event in one transaction", async () => {
    const { createGtmAccount } = await storePromise;
    insertResults = [
      [
        {
          id: "account-1",
          userId: "user-1",
          name: "Acme",
          sourceKind: "manual",
          domain: "acme.test",
        },
      ],
      [{ id: "event-1" }],
    ];

    const account = await createGtmAccount(
      {
        userId: "user-1",
        requestId: "req-1",
        name: "Acme",
        domain: "acme.test",
        metadata: { prompt: "do not persist raw prompt" },
      },
      fakeDatabase(),
    );

    expect(account.id).toBe("account-1");
    expect(transactionCount).toBe(1);
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[1]?.values).toMatchObject({
      eventName: "gtm.account.created",
      entityKind: "account",
      entityId: "account-1",
      requestId: "req-1",
      userId: "user-1",
    });
    const eventInsert = insertCalls[1];
    expect(eventInsert).toBeDefined();
    const payload = eventInsert?.values.payload as {
      metadata?: { prompt?: string };
    };
    expect(payload.metadata?.prompt).toMatch("[redacted:");
  });

  test("fails atomically when the ledger append returns no row", async () => {
    const { createGtmAccount } = await storePromise;
    insertResults = [
      [
        {
          id: "account-1",
          userId: "user-1",
          name: "Acme",
          sourceKind: "manual",
          domain: null,
        },
      ],
      [],
    ];

    await expect(
      createGtmAccount(
        {
          userId: "user-1",
          requestId: "req-1",
          name: "Acme",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "ledger_append_failed" });

    expect(transactionCount).toBe(1);
    expect(insertCalls).toHaveLength(2);
  });

  test("rejects contact links to accounts outside the caller scope", async () => {
    const { upsertGtmContact } = await storePromise;
    selectResults = [[]];

    await expect(
      upsertGtmContact(
        {
          userId: "user-1",
          requestId: "req-1",
          accountId: "foreign-account",
          name: "Morgan",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "cross_user_reference" });

    expect(transactionCount).toBe(1);
    expect(insertCalls).toHaveLength(0);
  });
});
