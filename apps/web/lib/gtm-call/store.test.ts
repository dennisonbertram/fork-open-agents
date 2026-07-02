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

describe("GTM call store", () => {
  test("creates a call prep touchpoint, run, and event", async () => {
    const { createGtmCallPrep } = await storePromise;
    selectResults = [[{ id: "account-1" }], [{ id: "contact-1" }]];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "call-1" }],
      [{ id: "event-1" }],
    ];

    const result = await createGtmCallPrep(
      {
        userId: "user-1",
        requestId: "req-1",
        accountId: "account-1",
        contactId: "contact-1",
        founderObjective: "Validate pilot fit",
        knownContext: ["Acme asked for approval-safe agents."],
        openLoops: ["Budget owner unknown."],
      },
      fakeDatabase(),
    );

    expect(result).toMatchObject({ callId: "call-1", runId: "run-1" });
    expect(transactionCount).toBe(1);
    expect(insertCalls[0]?.values).toMatchObject({
      runKind: "call_prep",
      status: "completed",
      requestId: "req-1",
    });
    expect(insertCalls[1]?.values).toMatchObject({
      channel: "call",
      status: "draft",
      accountId: "account-1",
      contactId: "contact-1",
    });
    expect(insertCalls[2]?.values).toMatchObject({
      eventName: "gtm.call_brief.created",
      entityKind: "touchpoint",
      entityId: "call-1",
    });
  });

  test("creates debrief insights and pending approvals without applying updates", async () => {
    const { createGtmCallDebrief } = await storePromise;
    selectResults = [[{ id: "account-1" }]];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "call-1" }],
      [{ id: "event-notes" }],
      [{ id: "insight-1" }],
      [{ id: "insight-2" }],
      [{ id: "approval-1" }],
      [{ id: "event-action-1" }],
      [{ id: "approval-2" }],
      [{ id: "event-action-2" }],
      [{ id: "event-complete" }],
    ];

    const result = await createGtmCallDebrief(
      {
        userId: "user-1",
        requestId: "req-1",
        accountId: "account-1",
        callId: "prep-call-1",
        notes:
          "Concern is legal review. Product request: GitHub issue drafting. Next we will send a pilot plan.",
        attendees: ["Morgan"],
      },
      fakeDatabase(),
    );

    expect(result.insightIds).toEqual(["insight-1", "insight-2"]);
    expect(result.approvalIds).toEqual(["approval-1", "approval-2"]);
    expect(result.callId).toBe("call-1");
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        id: expect.not.stringMatching("prep-call-1"),
        status: "pending_approval",
        channel: "call",
      }),
    );
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        actionKind: "call_follow_up_draft",
        status: "pending",
      }),
    );
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        actionKind: "call_gtm_record_update",
        targetKind: "account",
        targetId: "account-1",
        status: "pending",
      }),
    );
    expect(insertCalls.map((call) => call.values)).not.toContainEqual(
      expect.objectContaining({ status: "approved" }),
    );
  });

  test("rejects cross-user call targets before inserts", async () => {
    const { createGtmCallPrep } = await storePromise;
    selectResults = [[]];

    await expect(
      createGtmCallPrep(
        {
          userId: "user-1",
          requestId: "req-1",
          accountId: "foreign-account",
          founderObjective: "Prep",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "cross_user_reference" });

    expect(insertCalls).toHaveLength(0);
  });
});
