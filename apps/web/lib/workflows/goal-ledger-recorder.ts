"use server";

import type { TerminalGoalStatus } from "@/lib/db/goal-ledger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordGoalLedgerStartInput = {
  userId: string;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  objective: string;
};

export type RecordGoalLedgerEventInput = {
  goalId: string;
  userId: string;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
};

export type RecordGoalLedgerCloseInput = {
  goalId: string;
  terminalStatus: TerminalGoalStatus;
};

// ---------------------------------------------------------------------------
// Defensive wrappers
//
// Each wrapper uses "use step" so Workflow memoization applies to replay.
// All errors are caught and logged — recorder failures NEVER crash the chat
// workflow.
// ---------------------------------------------------------------------------

/**
 * Record the start of a workflow run in the goal ledger.
 *
 * Calls `createGoal` and returns the new goal id on success, or `null` if the
 * call fails. Never throws.
 */
export async function recordGoalLedgerStart(
  input: RecordGoalLedgerStartInput,
): Promise<string | null> {
  "use step";

  try {
    const { createGoal } = await import("@/lib/db/goal-ledger");
    const goal = await createGoal({
      userId: input.userId,
      sessionId: input.sessionId,
      chatId: input.chatId,
      workflowRunId: input.workflowRunId,
      objective: input.objective,
    });
    return goal.id;
  } catch (error: unknown) {
    console.error(
      "[goal-ledger-recorder] recordGoalLedgerStart failed:",
      error,
    );
    return null;
  }
}

/**
 * Append a ledger event to an existing goal.
 *
 * Calls `appendGoalEvent`. Swallows all errors. Never throws.
 */
export async function recordGoalLedgerEvent(
  input: RecordGoalLedgerEventInput,
): Promise<void> {
  "use step";

  try {
    const { appendGoalEvent } = await import("@/lib/db/goal-ledger");
    const eventInput: {
      goalId: string;
      userId: string;
      eventType: string;
      summary: string;
      payload?: Record<string, unknown>;
    } = {
      goalId: input.goalId,
      userId: input.userId,
      eventType: input.eventType,
      summary: input.summary,
    };
    if (input.payload !== undefined) {
      eventInput.payload = input.payload;
    }
    await appendGoalEvent(eventInput);
  } catch (error: unknown) {
    console.error(
      "[goal-ledger-recorder] recordGoalLedgerEvent failed:",
      error,
    );
  }
}

/**
 * Transition a goal to a terminal status.
 *
 * Calls `closeGoal(goalId, terminalStatus)`. Swallows all errors. Never throws.
 */
export async function recordGoalLedgerClose(
  input: RecordGoalLedgerCloseInput,
): Promise<void> {
  "use step";

  try {
    const { closeGoal } = await import("@/lib/db/goal-ledger");
    await closeGoal(input.goalId, input.terminalStatus);
  } catch (error: unknown) {
    console.error(
      "[goal-ledger-recorder] recordGoalLedgerClose failed:",
      error,
    );
  }
}
