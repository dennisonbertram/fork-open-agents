import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
};

type SelectResult = Array<Record<string, unknown>>;
type InsertResult = Array<Record<string, unknown>>;
type FakeDb = {
  transaction: <T>(callback: (tx: FakeDb) => T | Promise<T>) => Promise<T>;
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
    transaction: async <T>(callback: (tx: FakeDb) => T | Promise<T>) => {
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

describe("GTM outbound store", () => {
  test("creates a pending local draft, approval request, and ledger events", async () => {
    const { createGtmOutboundDraft } = await storePromise;
    selectResults = [[{ id: "account-1" }], [{ id: "contact-1" }]];
    insertResults = [
      [{ id: "touchpoint-1" }],
      [{ id: "approval-1" }],
      [{ id: "event-1" }],
      [{ id: "event-2" }],
    ];

    const result = await createGtmOutboundDraft(
      {
        userId: "user-1",
        requestId: "req-1",
        accountId: "account-1",
        contactId: "contact-1",
        subject: "Intro",
        body: "Hello from the agent.",
        recipientHash: "recipient-hash",
        recipientDomain: "acme.test",
        allowedDomains: ["acme.test"],
      },
      fakeDatabase(),
    );

    expect(result).toMatchObject({
      touchpointId: "touchpoint-1",
      approvalId: "approval-1",
      status: "pending_approval",
    });
    expect(transactionCount).toBe(1);
    expect(insertCalls).toHaveLength(4);
    expect(insertCalls[0]?.values).toMatchObject({
      userId: "user-1",
      accountId: "account-1",
      contactId: "contact-1",
      channel: "email",
      direction: "outbound",
      status: "pending_approval",
      bodyPreview: "Hello from the agent.",
    });
    expect(insertCalls[1]?.values).toMatchObject({
      actionKind: "email_send",
      targetKind: "touchpoint",
      targetId: "touchpoint-1",
      status: "pending",
      requestId: "req-1",
    });
    expect(insertCalls[2]?.values).toMatchObject({
      eventName: "gtm.touchpoint.recorded",
      entityKind: "touchpoint",
      entityId: "touchpoint-1",
      status: "blocked",
    });
    expect(insertCalls[3]?.values).toMatchObject({
      eventName: "gtm.approval.requested",
      entityKind: "approval",
      entityId: "approval-1",
      status: "blocked",
    });
  });

  test("rejects outbound drafts for contacts outside the caller scope", async () => {
    const { createGtmOutboundDraft } = await storePromise;
    selectResults = [[]];

    await expect(
      createGtmOutboundDraft(
        {
          userId: "user-1",
          requestId: "req-1",
          contactId: "foreign-contact",
          subject: "Intro",
          body: "Hello",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "cross_user_reference" });

    expect(insertCalls).toHaveLength(0);
  });

  test("blocks disallowed recipient domains before persistence", async () => {
    const { createGtmOutboundDraft } = await storePromise;

    await expect(
      createGtmOutboundDraft(
        {
          userId: "user-1",
          requestId: "req-1",
          subject: "Intro",
          body: "Hello",
          recipientDomain: "other.test",
          allowedDomains: ["acme.test"],
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "approval_required" });

    expect(transactionCount).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });
});
