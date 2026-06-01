/**
 * RED tests for FIX 3 (TASK-ISSUE-74): strengthened redaction assertion.
 *
 * Problem: R-002 only asserts redactHarnessValue was CALLED, not that the
 * persisted value is actually scrubbed. A bug that calls the redactor but
 * ignores its return value (persisting the raw secret) would PASS R-002.
 *
 * Fix: assert the value passed to .values()/.set() does NOT contain the
 * secret. This test is NON-VACUOUS: a version that persists the raw summary
 * while still calling the redactor will FAIL here.
 *
 * Mutation proof (verified during RED phase):
 *   If we change the persist site to use `input.summary` instead of
 *   `redactedSummary`, this test fails because the persisted value contains
 *   the raw secret "sk-1234567890123456".
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- Capture what is actually persisted ----
// We intercept the `.values()` call and record the payload passed to it.
let capturedInsertValues: Record<string, unknown> | null = null;
let capturedConflictSet: Record<string, unknown> | null = null;

const onConflictDoUpdateMock = mock(
  (opts: { target: unknown; set: Record<string, unknown> }) => {
    capturedConflictSet = opts.set;
    return {
      returning: mock(() =>
        Promise.resolve([
          {
            id: "wrun_redact",
            sessionId: "session-redact",
            chatId: null,
            userId: "user-redact",
            workflowRunId: null,
            taskToolCallId: "task-redact-1",
            workerType: "executor",
            status: "completed",
            sandboxName: null,
            profileId: null,
            profileVersion: null,
            profileDisplayName: null,
            profileRunId: null,
            toolCallCount: 0,
            summary: "deploy with OPENAI_API_KEY=[REDACTED]",
            startedAt: null,
            finishedAt: null,
            createdAt: new Date("2026-06-01T10:00:00.000Z"),
            updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ]),
      ),
    };
  },
);

const valuesMock = mock((payload: Record<string, unknown>) => {
  capturedInsertValues = payload;
  return { onConflictDoUpdate: onConflictDoUpdateMock };
});

const insertMock = mock(() => ({ values: valuesMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    query: {
      managedRuntimeWorkerRuns: {
        findMany: mock(() => Promise.resolve([])),
      },
    },
  },
}));

// Use a REAL-ISH redactor stub: replaces known patterns with [REDACTED]
// This is NOT a pass-through mock — it transforms the value.
mock.module("@/lib/harness/redaction", () => ({
  redactHarnessValue: mock((value: unknown, _field: string) => {
    if (typeof value !== "string") return value;
    return value
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_TOKEN]")
      .replace(
        /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=[^\s]+/g,
        (m) => `${m.split("=")[0]}=[REDACTED]`,
      );
  }),
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: mock(() => Promise.resolve(null)),
}));

const { recordManagedRuntimeWorkerRun } = await import(
  "./managed-runtime-worker-runs"
);

const SECRET_SUMMARY = "deploy with OPENAI_API_KEY=sk-1234567890123456";

describe("redaction: persisted value is actually scrubbed", () => {
  beforeEach(() => {
    insertMock.mockClear();
    capturedInsertValues = null;
    capturedConflictSet = null;
  });

  test("BT-REDACT-001: summary passed to .values() does NOT contain the raw secret", async () => {
    await recordManagedRuntimeWorkerRun({
      sessionId: "session-redact",
      chatId: null,
      userId: "user-redact",
      workflowRunId: null,
      taskToolCallId: "task-redact-1",
      workerType: "executor",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 0,
      summary: SECRET_SUMMARY,
      startedAt: null,
      finishedAt: null,
    });

    // The .values() payload must have been captured
    expect(capturedInsertValues).not.toBeNull();
    const persistedSummary = capturedInsertValues!.summary as string;

    // The raw secret key must NOT appear in the persisted value
    expect(persistedSummary).not.toContain("sk-1234567890123456");
    expect(persistedSummary).not.toContain("OPENAI_API_KEY=sk-");

    // The redacted placeholder must be present
    expect(persistedSummary).toContain("[REDACTED");
  });

  test("BT-REDACT-002: summary passed to onConflictDoUpdate.set does NOT contain the raw secret", async () => {
    // The upsert path uses both .values() and .set() — both must be redacted.
    await recordManagedRuntimeWorkerRun({
      sessionId: "session-redact",
      chatId: null,
      userId: "user-redact",
      workflowRunId: null,
      taskToolCallId: "task-redact-2",
      workerType: "executor",
      status: "running",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 0,
      summary: SECRET_SUMMARY,
      startedAt: null,
      finishedAt: null,
    });

    expect(capturedConflictSet).not.toBeNull();
    const setPayloadSummary = capturedConflictSet!.summary as string;

    // The conflict-update set must also be scrubbed
    expect(setPayloadSummary).not.toContain("sk-1234567890123456");
    expect(setPayloadSummary).not.toContain("OPENAI_API_KEY=sk-");
    expect(setPayloadSummary).toContain("[REDACTED");
  });

  test("BT-REDACT-003: mutation proof — if raw summary is persisted instead of redacted, this test fails", async () => {
    // This test explicitly documents what a regression looks like.
    // If the implementation persists input.summary directly (bug),
    // the persisted value would equal SECRET_SUMMARY and contain "sk-1234567890123456".
    // The assertion below confirms the scrubbed value differs from the raw input.

    await recordManagedRuntimeWorkerRun({
      sessionId: "session-redact",
      chatId: null,
      userId: "user-redact",
      workflowRunId: null,
      taskToolCallId: "task-redact-3",
      workerType: "executor",
      status: "completed",
      sandboxName: null,
      profileId: null,
      profileVersion: null,
      profileDisplayName: null,
      profileRunId: null,
      toolCallCount: 0,
      summary: SECRET_SUMMARY,
      startedAt: null,
      finishedAt: null,
    });

    const persistedSummary = capturedInsertValues!.summary as string;

    // The persisted value MUST differ from the raw input (redaction changed it)
    expect(persistedSummary).not.toBe(SECRET_SUMMARY);

    // Positive assertion: the redacted form contains the field name but not the value
    expect(persistedSummary).toContain("OPENAI_API_KEY=[REDACTED]");
  });
});
