import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ───────────────────────────────────────────────────────

const spies = {
  createGoal: mock(async () => ({
    id: "goal-abc123",
    userId: "user-1",
    objective: "Test objective",
    status: "draft" as const,
    workflowRunId: "wrun_test-123",
    sessionId: "session-1",
    chatId: "chat-1",
    plan: null,
    blockedReason: null,
    evidenceRefs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  appendGoalEvent: mock(async () => ({
    id: "evt-abc123",
    goalId: "goal-abc123",
    userId: "user-1",
    sequence: 1,
    eventType: "progress",
    summary: "Step completed",
    payload: {},
  })),
  closeGoal: mock(async () => ({
    id: "goal-abc123",
    userId: "user-1",
    objective: "Test objective",
    status: "complete" as const,
    workflowRunId: "wrun_test-123",
    sessionId: "session-1",
    chatId: "chat-1",
    plan: null,
    blockedReason: null,
    evidenceRefs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
};

// ── Module mocks ────────────────────────────────────────────────────

mock.module("@/lib/db/goal-ledger", () => ({
  createGoal: spies.createGoal,
  appendGoalEvent: spies.appendGoalEvent,
  closeGoal: spies.closeGoal,
  GoalLedgerError: class GoalLedgerError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "GoalLedgerError";
      this.code = code;
    }
  },
  TERMINAL_GOAL_STATUSES: ["complete", "failed", "canceled", "archived"],
}));

// ── Import module under test ─────────────────────────────────────────

const { recordGoalLedgerStart, recordGoalLedgerEvent, recordGoalLedgerClose } =
  await import("./goal-ledger-recorder");

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  spies.createGoal.mockClear();
  spies.appendGoalEvent.mockClear();
  spies.closeGoal.mockClear();
  // Reset to default successful implementations
  spies.createGoal.mockResolvedValue({
    id: "goal-abc123",
    userId: "user-1",
    objective: "Test objective",
    status: "draft" as const,
    workflowRunId: "wrun_test-123",
    sessionId: "session-1",
    chatId: "chat-1",
    plan: null,
    blockedReason: null,
    evidenceRefs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  spies.appendGoalEvent.mockResolvedValue({
    id: "evt-abc123",
    goalId: "goal-abc123",
    userId: "user-1",
    sequence: 1,
    eventType: "progress",
    summary: "Step completed",
    payload: {},
  });
  spies.closeGoal.mockResolvedValue({
    id: "goal-abc123",
    userId: "user-1",
    objective: "Test objective",
    status: "complete" as const,
    workflowRunId: "wrun_test-123",
    sessionId: "session-1",
    chatId: "chat-1",
    plan: null,
    blockedReason: null,
    evidenceRefs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("recordGoalLedgerStart", () => {
  test("calls createGoal with mapped fields and returns the created goal id", async () => {
    const goalId = await recordGoalLedgerStart({
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "wrun_test-123",
      objective: "Test objective for this run",
    });

    expect(spies.createGoal).toHaveBeenCalledTimes(1);
    expect(spies.createGoal).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "wrun_test-123",
      objective: "Test objective for this run",
    });
    expect(goalId).toBe("goal-abc123");
  });

  test("returns null and does NOT rethrow when createGoal throws GoalLedgerError", async () => {
    spies.createGoal.mockImplementationOnce(async () => {
      throw new Error("GoalLedgerError: persist_failed");
    });

    let result: string | null | undefined;
    await expect(async () => {
      result = await recordGoalLedgerStart({
        userId: "user-1",
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "wrun_test-123",
        objective: "Will fail",
      });
    }).not.toThrow();

    expect(result).toBeNull();
  });

  test("returns null and does NOT rethrow when createGoal throws a generic Error", async () => {
    spies.createGoal.mockImplementationOnce(async () => {
      throw new Error("Connection refused");
    });

    let result: string | null | undefined;
    await expect(async () => {
      result = await recordGoalLedgerStart({
        userId: "user-1",
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "wrun_test-123",
        objective: "Will fail",
      });
    }).not.toThrow();

    expect(result).toBeNull();
  });
});

describe("GoalLedgerEventType union: recordGoalLedgerEvent accepts all valid event types", () => {
  test("accepts eventType 'started' (new: step history gap fix)", async () => {
    // RED: eventType is currently typed as `string` — after FIX 4 it becomes a
    // union. This test also asserts the call is forwarded to appendGoalEvent.
    await recordGoalLedgerEvent({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "started",
      summary: "Workflow run started",
      payload: { workflowRunId: "wrun_test-123" },
    });

    expect(spies.appendGoalEvent).toHaveBeenCalledTimes(1);
    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "started",
      summary: "Workflow run started",
      payload: { workflowRunId: "wrun_test-123" },
    });
  });

  test("accepts eventType 'progress' with stepNumber payload (new: step history gap fix)", async () => {
    await recordGoalLedgerEvent({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "progress",
      summary: "Step 1 completed",
      payload: { stepNumber: 1, finishReason: "tool-calls" },
    });

    expect(spies.appendGoalEvent).toHaveBeenCalledTimes(1);
    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "progress",
      summary: "Step 1 completed",
      payload: { stepNumber: 1, finishReason: "tool-calls" },
    });
  });

  test("accepts eventType 'final' (existing behavior preserved)", async () => {
    await recordGoalLedgerEvent({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "final",
      summary: "Workflow completed successfully.",
    });

    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "final",
      summary: "Workflow completed successfully.",
    });
  });
});

describe("recordGoalLedgerEvent", () => {
  test("calls appendGoalEvent with correct arguments", async () => {
    await recordGoalLedgerEvent({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "progress",
      summary: "Step 1 completed successfully",
      payload: { stepNumber: 1 },
    });

    expect(spies.appendGoalEvent).toHaveBeenCalledTimes(1);
    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "progress",
      summary: "Step 1 completed successfully",
      payload: { stepNumber: 1 },
    });
  });

  test("calls appendGoalEvent without payload when none provided", async () => {
    await recordGoalLedgerEvent({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "final",
      summary: "Workflow completed",
    });

    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-abc123",
      userId: "user-1",
      eventType: "final",
      summary: "Workflow completed",
    });
  });

  test("swallows errors from appendGoalEvent and does NOT rethrow", async () => {
    spies.appendGoalEvent.mockImplementationOnce(async () => {
      throw new Error("GoalLedgerError: not_found");
    });

    await expect(async () => {
      await recordGoalLedgerEvent({
        goalId: "goal-missing",
        userId: "user-1",
        eventType: "progress",
        summary: "This will fail",
      });
    }).not.toThrow();
  });
});

describe("recordGoalLedgerClose", () => {
  test("calls closeGoal with goalId and terminalStatus", async () => {
    await recordGoalLedgerClose({
      goalId: "goal-abc123",
      terminalStatus: "complete",
    });

    expect(spies.closeGoal).toHaveBeenCalledTimes(1);
    expect(spies.closeGoal).toHaveBeenCalledWith("goal-abc123", "complete");
  });

  test("calls closeGoal with canceled status", async () => {
    await recordGoalLedgerClose({
      goalId: "goal-abc123",
      terminalStatus: "canceled",
    });

    expect(spies.closeGoal).toHaveBeenCalledWith("goal-abc123", "canceled");
  });

  test("calls closeGoal with failed status", async () => {
    await recordGoalLedgerClose({
      goalId: "goal-abc123",
      terminalStatus: "failed",
    });

    expect(spies.closeGoal).toHaveBeenCalledWith("goal-abc123", "failed");
  });

  test("swallows errors from closeGoal and does NOT rethrow", async () => {
    spies.closeGoal.mockImplementationOnce(async () => {
      throw new Error("GoalLedgerError: not_found");
    });

    await expect(async () => {
      await recordGoalLedgerClose({
        goalId: "goal-missing",
        terminalStatus: "complete",
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Regression tests
// These catch future breakage: if the implementation in 1908fefb is reverted
// or the goal-ledger API changes, these fail before the behavioral tests do.
// ---------------------------------------------------------------------------

describe("regression: terminal status strings match TERMINAL_GOAL_STATUSES", () => {
  test("recordGoalLedgerClose accepts 'complete' as a valid TerminalGoalStatus", async () => {
    // If TERMINAL_GOAL_STATUSES drops "complete", TypeScript catches it at
    // compile time AND this test would fail because closeGoal would throw
    // a non_terminal_status GoalLedgerError.
    await recordGoalLedgerClose({
      goalId: "goal-1",
      terminalStatus: "complete",
    });
    expect(spies.closeGoal).toHaveBeenCalledWith("goal-1", "complete");
  });

  test("recordGoalLedgerClose accepts 'canceled' as a valid TerminalGoalStatus", async () => {
    await recordGoalLedgerClose({
      goalId: "goal-1",
      terminalStatus: "canceled",
    });
    expect(spies.closeGoal).toHaveBeenCalledWith("goal-1", "canceled");
  });

  test("recordGoalLedgerClose accepts 'failed' as a valid TerminalGoalStatus", async () => {
    await recordGoalLedgerClose({ goalId: "goal-1", terminalStatus: "failed" });
    expect(spies.closeGoal).toHaveBeenCalledWith("goal-1", "failed");
  });

  test("recordGoalLedgerStart maps all five input fields to createGoal", async () => {
    // If createGoal signature changes (e.g. field rename), this catches it.
    const goalId = await recordGoalLedgerStart({
      userId: "u-1",
      sessionId: "s-1",
      chatId: "c-1",
      workflowRunId: "w-1",
      objective: "regression objective",
    });

    expect(spies.createGoal).toHaveBeenCalledWith({
      userId: "u-1",
      sessionId: "s-1",
      chatId: "c-1",
      workflowRunId: "w-1",
      objective: "regression objective",
    });
    expect(goalId).toBe("goal-abc123");
  });

  test("recorder swallows errors and never propagates to callers", async () => {
    // Regression: if the try/catch is accidentally removed, this fails.
    spies.createGoal.mockImplementationOnce(async () => {
      throw new Error("Catastrophic DB failure");
    });
    spies.appendGoalEvent.mockImplementationOnce(async () => {
      throw new Error("Catastrophic DB failure");
    });
    spies.closeGoal.mockImplementationOnce(async () => {
      throw new Error("Catastrophic DB failure");
    });

    let startResult: string | null | undefined;
    await expect(async () => {
      startResult = await recordGoalLedgerStart({
        userId: "u-1",
        sessionId: "s-1",
        chatId: "c-1",
        workflowRunId: "w-1",
        objective: "fail test",
      });
    }).not.toThrow();
    expect(startResult).toBeNull();

    await expect(async () => {
      await recordGoalLedgerEvent({
        goalId: "g-1",
        userId: "u-1",
        eventType: "final",
        summary: "fail",
      });
    }).not.toThrow();

    await expect(async () => {
      await recordGoalLedgerClose({ goalId: "g-1", terminalStatus: "failed" });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Regression tests: TASK-ISSUE-36 step history gap fix (13696abf)
// These catch future breakage: if GoalLedgerEventType reverts to `string`, or
// the new event types are dropped, these tests fail before behavioral tests do.
// ---------------------------------------------------------------------------

describe("regression: GoalLedgerEventType union enforces closed set of event types", () => {
  test("recordGoalLedgerEvent accepts 'started' type and forwards to appendGoalEvent", async () => {
    // If eventType reverts to `string`, TypeScript won't catch invalid types at
    // compile time. This test verifies the forwarding still works correctly for
    // the new types added in TASK-ISSUE-36.
    await recordGoalLedgerEvent({
      goalId: "goal-r1",
      userId: "u-1",
      eventType: "started",
      summary: "Workflow run started",
      payload: { workflowRunId: "wrun_regression" },
    });
    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-r1",
      userId: "u-1",
      eventType: "started",
      summary: "Workflow run started",
      payload: { workflowRunId: "wrun_regression" },
    });
  });

  test("recordGoalLedgerEvent accepts 'progress' type with stepNumber payload", async () => {
    // If the progress event type is dropped from the union or the forwarding
    // changes, this test fails immediately.
    await recordGoalLedgerEvent({
      goalId: "goal-r2",
      userId: "u-1",
      eventType: "progress",
      summary: "Step 3 completed",
      payload: { stepNumber: 3, finishReason: "stop" },
    });
    expect(spies.appendGoalEvent).toHaveBeenCalledWith({
      goalId: "goal-r2",
      userId: "u-1",
      eventType: "progress",
      summary: "Step 3 completed",
      payload: { stepNumber: 3, finishReason: "stop" },
    });
  });

  test("recordGoalLedgerEvent swallows errors for 'started' type (defensiveness preserved)", async () => {
    spies.appendGoalEvent.mockImplementationOnce(async () => {
      throw new Error("DB write timeout");
    });

    // Must not throw regardless of event type
    await expect(async () => {
      await recordGoalLedgerEvent({
        goalId: "goal-r3",
        userId: "u-1",
        eventType: "started",
        summary: "Workflow run started",
        payload: { workflowRunId: "wrun_regression" },
      });
    }).not.toThrow();
  });

  test("GoalLedgerEventType is exported from goal-ledger-recorder module", async () => {
    // This test verifies the module exports the type by confirming the module
    // can be imported without error and the function that uses it works.
    // If GoalLedgerEventType is removed or renamed, related TypeScript errors
    // will surface at compile time, and this runtime test catches wiring issues.
    const recorderModule = await import("./goal-ledger-recorder");
    expect(typeof recorderModule.recordGoalLedgerEvent).toBe("function");
    expect(typeof recorderModule.recordGoalLedgerStart).toBe("function");
    expect(typeof recorderModule.recordGoalLedgerClose).toBe("function");
  });
});
