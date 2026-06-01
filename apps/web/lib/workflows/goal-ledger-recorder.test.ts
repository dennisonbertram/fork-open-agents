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
    spies.createGoal.mockRejectedValueOnce(
      new Error("GoalLedgerError: persist_failed"),
    );

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
    spies.createGoal.mockRejectedValueOnce(new Error("Connection refused"));

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
    spies.appendGoalEvent.mockRejectedValueOnce(
      new Error("GoalLedgerError: not_found"),
    );

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
    spies.closeGoal.mockRejectedValueOnce(
      new Error("GoalLedgerError: not_found"),
    );

    await expect(async () => {
      await recordGoalLedgerClose({
        goalId: "goal-missing",
        terminalStatus: "complete",
      });
    }).not.toThrow();
  });
});
