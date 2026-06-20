import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Mock server-only to allow test imports
mock.module("server-only", () => ({}));

// BT-010: DB idempotency — consumeToolApproval second call returns null
//
// FIX-2: Stateful fake DB that genuinely enforces the consumed=false predicate.
//
// The fakeDb holds an in-memory row store keyed by approvalId.
// update().set(data).where(condition).returning() uses PgDialect to inspect the
// WHERE condition: if it encodes consumed=false AND the in-memory row has
// consumed=true, the UPDATE matches nothing → returns [].
// This means removing the WHERE consumed=false from consumeToolApproval makes
// the second call return the already-consumed row → the idempotency test FAILS.

/**
 * Evaluate whether a Drizzle WHERE condition encodes the consumed=false guard.
 * Uses PgDialect.sqlToQuery to extract the generated SQL and params.
 * Returns true only when the condition SQL references "consumed" and includes
 * the boolean literal `false` in the params array.
 */
function conditionIncludesConsumedFalseGuard(
  condition: SQL | undefined,
): boolean {
  if (!condition) return false;
  try {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(condition);
    return sql.toLowerCase().includes("consumed") && params.includes(false);
  } catch {
    return false;
  }
}

// In-memory row store for the stateful fake
type StoredRow = Record<string, unknown>;
const rowStore = new Map<string, StoredRow>();

// Builders for insert/select/update results (reset per-test)
type InsertResult = Record<string, unknown>[];
type SelectResult = Record<string, unknown>[];

let insertResult: InsertResult = [];
let selectResult: SelectResult = [];

/**
 * Stateful fake DB.
 *
 * update().set(data).where(condition).returning():
 *   - Uses PgDialect to inspect the WHERE condition.
 *   - If condition enforces consumed=false AND the stored row has consumed=true
 *     → returns [] (the guard fires, simulating no matching rows).
 *   - Otherwise mutates the row and returns it.
 *   - If no row is found by approvalId → returns [].
 *
 * The WHERE condition is extracted from the SQL params. The approvalId is the
 * first string param; consumed=false is the boolean param.
 */
const fakeDb = {
  insert: (_table: unknown) => ({
    values: (_data: unknown) => ({
      returning: async () => insertResult,
    }),
  }),
  select: () => ({
    from: (_table: unknown) => ({
      where: async (_condition: unknown) => selectResult,
    }),
  }),
  update: (_table: unknown) => ({
    set: (data: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async (): Promise<StoredRow[]> => {
          const sqlCondition = condition as SQL | undefined;

          // Extract the WHERE params to find the approvalId
          let approvalIdParam: string | undefined;
          try {
            const dialect = new PgDialect();
            const { params } = dialect.sqlToQuery(sqlCondition!);
            // The approvalId is the first string param in the WHERE clause
            approvalIdParam = params.find(
              (p): p is string => typeof p === "string",
            );
          } catch {
            return [];
          }

          if (!approvalIdParam) return [];

          const storedRow = rowStore.get(approvalIdParam);
          if (!storedRow) return [];

          // Enforce the consumed=false guard: if the condition requires
          // consumed=false and the row is already consumed, return empty set.
          if (
            conditionIncludesConsumedFalseGuard(sqlCondition) &&
            storedRow.consumed === true
          ) {
            return []; // WHERE consumed=false does not match
          }

          // Apply the update to the stored row
          const updatedRow = { ...storedRow, ...data };
          rowStore.set(approvalIdParam, updatedRow);
          return [updatedRow];
        },
      }),
    }),
  }),
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const toolApprovalsModule = import("./tool-approvals");

describe("tool-approvals DB module", () => {
  beforeEach(() => {
    insertResult = [];
    selectResult = [];
    rowStore.clear();
  });

  // BT-010: parkToolApproval inserts a new record
  test("parkToolApproval inserts a parked record with pending decision", async () => {
    const { parkToolApproval } = await toolApprovalsModule;

    const fakeRecord = {
      id: "appr-1",
      approvalId: "approval-abc-123",
      toolName: "bash",
      toolCallId: "tool-call-1",
      category: "dangerous-command",
      reason: "rm -rf detected",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      decision: "pending",
      consumed: false,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    insertResult = [fakeRecord];

    const result = await parkToolApproval({
      id: "appr-1",
      approvalId: "approval-abc-123",
      toolName: "bash",
      toolCallId: "tool-call-1",
      category: "dangerous-command",
      reason: "rm -rf detected",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result?.approvalId).toBe("approval-abc-123");
    expect(result?.decision).toBe("pending");
    expect(result?.consumed).toBe(false);
  });

  // BT-011: getToolApproval retrieves by approvalId
  test("getToolApproval returns a record by approvalId", async () => {
    const { getToolApproval } = await toolApprovalsModule;

    const storedRecord = {
      id: "appr-2",
      approvalId: "approval-get-test",
      toolName: "webFetch",
      toolCallId: "tool-call-2",
      category: "external-write",
      reason: null,
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      decision: "pending",
      consumed: false,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    selectResult = [storedRecord];

    const result = await getToolApproval("approval-get-test");
    expect(result).not.toBeNull();
    expect(result?.approvalId).toBe("approval-get-test");
  });

  test("getToolApproval returns null when not found", async () => {
    const { getToolApproval } = await toolApprovalsModule;
    selectResult = [];

    const result = await getToolApproval("non-existent");
    expect(result).toBeNull();
  });

  // BT-012: consumeToolApproval first call returns the record with updated decision
  test("consumeToolApproval first call marks consumed=true and sets decision", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    // Seed the stateful row store with an unconsumed record
    rowStore.set("approval-consume-test", {
      id: "appr-3",
      approvalId: "approval-consume-test",
      toolName: "bash",
      toolCallId: "tool-call-3",
      category: "dangerous-command",
      reason: "rm -rf",
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      decision: "pending",
      consumed: false,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await consumeToolApproval(
      "approval-consume-test",
      "approved",
    );
    expect(result).not.toBeNull();
    expect(result?.consumed).toBe(true);
    expect(result?.decision).toBe("approved");
  });

  // BT-013: consumeToolApproval idempotency — second call returns null (no double-apply)
  //
  // This test uses a stateful fake that genuinely enforces the consumed=false predicate.
  // If the WHERE consumed=false guard is removed from consumeToolApproval.ts, this test
  // will FAIL because the fake will return the already-consumed row on the second call.
  //
  // Mutation proof: temporarily remove eq(consumed, false) from consumeToolApproval →
  // conditionIncludesConsumedFalseGuard returns false → storedRow.consumed=true check
  // is skipped → row is returned on second call → expect(second).toBeNull() FAILS.
  test("consumeToolApproval second call returns null — stateful fake enforces consumed=false guard (FIX-2)", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    const approvalId = "approval-idempotency-stateful";

    // Seed the stateful row store with an unconsumed record
    rowStore.set(approvalId, {
      id: "appr-idem",
      approvalId,
      toolName: "bash",
      toolCallId: "tool-call-idem",
      category: "git-force-push",
      reason: "git push --force",
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      decision: "pending",
      consumed: false,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // First call: row is unconsumed (consumed=false) → WHERE matches → row updated
    const first = await consumeToolApproval(approvalId, "approved");
    expect(first).not.toBeNull();
    expect(first?.decision).toBe("approved");
    expect(first?.consumed).toBe(true);

    // After first call, the in-memory row now has consumed=true.
    // Second call: WHERE consumed=false does NOT match → returns [] → null
    const second = await consumeToolApproval(approvalId, "approved");
    expect(second).toBeNull();
  });
});

// BT-014: classifyToolApproval is the source-of-truth for webFetch approval
// Tests here verify the policy itself via direct import (no module-mock collisions)
describe("webFetch policy via classifyToolApproval (BT-014)", () => {
  test("classifyToolApproval webFetch POST returns requires:true", async () => {
    const { classifyToolApproval } =
      await import("../../../../packages/agent/tools/approval-policy");
    const result = classifyToolApproval("webFetch", { method: "POST" });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test("classifyToolApproval webFetch GET returns requires:false", async () => {
    const { classifyToolApproval } =
      await import("../../../../packages/agent/tools/approval-policy");
    const result = classifyToolApproval("webFetch", { method: "GET" });
    expect(result.requires).toBe(false);
  });
});
