import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type InsertCall = {
  values: Record<string, unknown>;
};
type UpdateCall = {
  values: Record<string, unknown>;
};
type SelectResult = Array<Record<string, unknown>>;
type DbResult = Array<Record<string, unknown>>;
type FakeDb = {
  transaction: <T>(callback: (tx: FakeDb) => T | Promise<T>) => Promise<T>;
  select: () => {
    from: () => {
      where: () => SelectResult;
    };
  };
  update: () => {
    set: (values: Record<string, unknown>) => {
      where: () => {
        returning: () => Promise<DbResult>;
      };
    };
  };
  insert: () => {
    values: (values: Record<string, unknown>) => {
      returning: () => Promise<DbResult>;
    };
  };
};

const insertCalls: InsertCall[] = [];
const updateCalls: UpdateCall[] = [];
let selectResults: SelectResult[] = [];
let updateResults: DbResult[] = [];
let insertResults: DbResult[] = [];
let transactionCount = 0;

function buildFakeDb(): FakeDb {
  return {
    transaction: async <T>(callback: (tx: FakeDb) => T | Promise<T>) => {
      transactionCount += 1;
      return callback(buildFakeDb());
    },
    select: () => ({
      from: () => ({
        where: () => selectResults.shift() ?? [],
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ values });
        return {
          where: () => ({
            returning: async () => updateResults.shift() ?? [],
          }),
        };
      },
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
  updateCalls.length = 0;
  selectResults = [];
  updateResults = [];
  insertResults = [];
  transactionCount = 0;
});

describe("GTM approval decisions", () => {
  test("updates a pending approval and appends a decision event", async () => {
    const { decideGtmApproval } = await storePromise;
    selectResults = [
      [
        {
          id: "approval-1",
          status: "pending",
          actionKind: "email_send",
          targetKind: "touchpoint",
          targetId: "touchpoint-1",
        },
      ],
    ];
    updateResults = [
      [
        {
          id: "approval-1",
          actionKind: "email_send",
          targetKind: "touchpoint",
          targetId: "touchpoint-1",
        },
      ],
    ];
    insertResults = [[{ id: "event-1" }]];

    const result = await decideGtmApproval(
      {
        userId: "user-1",
        approvalId: "approval-1",
        requestId: "req-1",
        decision: "approved",
      },
      fakeDatabase(),
    );

    expect(result).toMatchObject({
      approvalId: "approval-1",
      status: "approved",
      targetKind: "touchpoint",
      targetId: "touchpoint-1",
      actionKind: "email_send",
    });
    expect(transactionCount).toBe(1);
    expect(updateCalls[0]?.values).toMatchObject({
      status: "approved",
      decidedBy: "user-1",
    });
    expect(insertCalls[0]?.values).toMatchObject({
      eventName: "gtm.approval.decided",
      entityKind: "approval",
      entityId: "approval-1",
      status: "succeeded",
    });
  });

  test("rejects missing approvals without inserting events", async () => {
    const { decideGtmApproval } = await storePromise;
    selectResults = [[]];

    await expect(
      decideGtmApproval(
        {
          userId: "user-1",
          approvalId: "missing",
          requestId: "req-1",
          decision: "denied",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "approval_not_found" });

    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  test("rejects already decided approvals", async () => {
    const { decideGtmApproval } = await storePromise;
    selectResults = [[{ id: "approval-1", status: "approved" }]];

    await expect(
      decideGtmApproval(
        {
          userId: "user-1",
          approvalId: "approval-1",
          requestId: "req-1",
          decision: "denied",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "approval_already_decided" });

    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  test("rejects concurrently decided approvals without inserting events", async () => {
    const { decideGtmApproval } = await storePromise;
    selectResults = [
      [
        {
          id: "approval-1",
          status: "pending",
          actionKind: "email_send",
          targetKind: "touchpoint",
          targetId: "touchpoint-1",
        },
      ],
    ];
    updateResults = [[]];

    await expect(
      decideGtmApproval(
        {
          userId: "user-1",
          approvalId: "approval-1",
          requestId: "req-1",
          decision: "approved",
        },
        fakeDatabase(),
      ),
    ).rejects.toMatchObject({ kind: "approval_already_decided" });

    expect(updateCalls[0]?.values).toMatchObject({ status: "approved" });
    expect(insertCalls).toHaveLength(0);
  });
});
