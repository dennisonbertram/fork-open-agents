import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock server-only to allow test imports
mock.module("server-only", () => ({}));

// BT-010: DB idempotency — consumeToolApproval second call returns null

// We build a mutable fakeDb that tests can configure per-call
type InsertResult = Record<string, unknown>[];
type SelectResult = Record<string, unknown>[];
type UpdateResult = Record<string, unknown>[];

let insertResult: InsertResult = [];
let selectResult: SelectResult = [];
let updateResult: UpdateResult = [];

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
    set: (_data: unknown) => ({
      where: (_condition: unknown) => ({
        returning: async () => updateResult,
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
    updateResult = [];
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

    const updatedRecord = {
      id: "appr-3",
      approvalId: "approval-consume-test",
      toolName: "bash",
      toolCallId: "tool-call-3",
      category: "dangerous-command",
      reason: "rm -rf",
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      decision: "approved",
      consumed: true,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    updateResult = [updatedRecord];

    const result = await consumeToolApproval(
      "approval-consume-test",
      "approved",
    );
    expect(result).not.toBeNull();
    expect(result?.consumed).toBe(true);
    expect(result?.decision).toBe("approved");
  });

  // BT-013: consumeToolApproval idempotency — second call returns null (no double-apply)
  test("consumeToolApproval second call returns null (idempotency guard)", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    // The WHERE clause consumed=false will match nothing on second call
    // The RETURNING result is empty — simulating already-consumed record
    updateResult = []; // empty → already consumed

    const result = await consumeToolApproval(
      "approval-already-consumed",
      "denied",
    );
    expect(result).toBeNull();
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
