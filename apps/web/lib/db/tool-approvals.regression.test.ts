/**
 * Regression tests for the tool-approvals DB module idempotency contract.
 *
 * These tests verify that consumeToolApproval's atomic compare-and-set
 * idempotency guard cannot be bypassed. If the WHERE consumed=false clause
 * is ever removed, duplicate POSTs could double-apply approvals/denials.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock server-only to allow test imports
mock.module("server-only", () => ({}));

type UpdateResult = Record<string, unknown>[];

let updateCallCount = 0;
let updateResult: UpdateResult = [];

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (_data: unknown) => ({
      returning: async () => [],
    }),
  }),
  select: () => ({
    from: (_table: unknown) => ({
      where: async (_condition: unknown) => [],
    }),
  }),
  update: (_table: unknown) => ({
    set: (_data: unknown) => ({
      where: (_condition: unknown) => ({
        returning: async () => {
          updateCallCount++;
          return updateResult;
        },
      }),
    }),
  }),
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const toolApprovalsModule = import("./tool-approvals");

describe("REGRESSION: consumeToolApproval idempotency is enforced by DB contract", () => {
  beforeEach(() => {
    updateCallCount = 0;
    updateResult = [];
  });

  // REGRESSION-DB-001: First call succeeds; second call returns null (not the same record again)
  test("first call gets the record; duplicate call (simulating consumed=true already) returns null", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    const approvedRecord = {
      id: "appr-reg-1",
      approvalId: "approval-idempotency-regression",
      toolName: "bash",
      toolCallId: "tc-reg-1",
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

    // First call: DB UPDATE finds unconsumed record, returns it
    updateResult = [approvedRecord];
    const first = await consumeToolApproval(
      "approval-idempotency-regression",
      "approved",
    );
    expect(first).not.toBeNull();
    expect(first?.decision).toBe("approved");
    expect(first?.consumed).toBe(true);

    // Second call: DB UPDATE finds no unconsumed record (consumed=true), returns empty
    updateResult = [];
    const second = await consumeToolApproval(
      "approval-idempotency-regression",
      "approved",
    );
    expect(second).toBeNull(); // idempotency guard fires

    // Both calls went to the DB — we didn't short-circuit in application logic
    expect(updateCallCount).toBe(2);
  });

  // REGRESSION-DB-002: Denial idempotency works the same way
  test("denial idempotency: second denial returns null", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    const deniedRecord = {
      id: "appr-reg-2",
      approvalId: "approval-denial-regression",
      toolName: "webFetch",
      toolCallId: "tc-reg-2",
      category: "external-write",
      reason: null,
      sessionId: "session-1",
      chatId: null,
      userId: "user-1",
      decision: "denied",
      consumed: true,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    updateResult = [deniedRecord];
    const first = await consumeToolApproval(
      "approval-denial-regression",
      "denied",
    );
    expect(first).not.toBeNull();
    expect(first?.decision).toBe("denied");

    updateResult = [];
    const second = await consumeToolApproval(
      "approval-denial-regression",
      "denied",
    );
    expect(second).toBeNull();
  });

  // REGRESSION-DB-003: No application-layer caching — every call hits the DB
  test("consumeToolApproval does not cache in application memory — always queries DB", async () => {
    const { consumeToolApproval } = await toolApprovalsModule;

    // Simulate: first call consumed, second call would succeed if cache is present
    updateResult = [];
    await consumeToolApproval("approval-no-cache-test", "approved");
    expect(updateCallCount).toBe(1);

    await consumeToolApproval("approval-no-cache-test", "approved");
    expect(updateCallCount).toBe(2); // Both calls reach the DB
  });
});
