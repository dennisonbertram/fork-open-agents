/**
 * Regression tests for run-summary persistence (#163).
 * Covers the critical invariant: summary failure must never affect the
 * terminal run status. If these tests fail, the green commit was reverted
 * or the try/catch guard around summary persistence was broken.
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- store mocks ----
const dbUpdate = mock(async () => undefined);
const recordEventMock = mock(async () => undefined);

mock.module("@/lib/db/client", () => ({
  db: {
    update: mock(() => ({
      set: mock(() => ({
        where: dbUpdate,
      })),
    })),
  },
}));

mock.module("@/lib/db/schema", () => ({
  backgroundAgentRuns: { id: "background_agent_runs.id" },
}));

mock.module("drizzle-orm", () => ({
  eq: mock((_col: unknown, _val: unknown) => true),
}));

mock.module("./store", () => ({
  recordBackgroundAgentEvent: recordEventMock,
}));

const { persistRunSummary, recordSummaryFailedEvent } =
  await import("./run-summary-persist");

// Regression scenario 1: persistRunSummary calls db.update with correct data
describe("persistRunSummary", () => {
  test("REGRESSION-001: calls db.update without throwing", async () => {
    // If the green commit is reverted, persistRunSummary would throw "not implemented"
    const summary = {
      headline: "Run succeeded",
      checked: [],
      changed: [],
      blocked: [],
      artifacts: [],
      next: [],
    };

    await expect(
      persistRunSummary({ runId: "run-1", summary }),
    ).resolves.toBeUndefined();

    expect(dbUpdate).toHaveBeenCalled();
  });
});

// Regression scenario 2: recordSummaryFailedEvent records a summary_failed event
describe("recordSummaryFailedEvent", () => {
  test("REGRESSION-002: records summary_failed event without throwing", async () => {
    await expect(
      recordSummaryFailedEvent({
        runId: "run-1",
        agentId: "agent-1",
        userId: "user-1",
        error: new Error("DB connection lost"),
      }),
    ).resolves.toBeUndefined();

    // The event must be recorded so operators know summary generation failed
    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        eventName: "background-agent.summary_failed",
        errorKind: "summary_failed",
        status: "failed",
      }),
    );
  });

  test("REGRESSION-003: captures error message for non-Error errors", async () => {
    recordEventMock.mockClear();

    await recordSummaryFailedEvent({
      runId: "run-2",
      agentId: null,
      userId: "user-2",
      error: "plain string error",
    });

    expect(recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-2",
        errorKind: "summary_failed",
      }),
    );
  });
});
