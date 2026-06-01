"use server";

// Stub — implementation will follow in the GREEN commit.
// All exports are intentionally broken (throw or return wrong values)
// so the behavioral tests fail meaningfully.

export async function recordGoalLedgerStart(_input: {
  userId: string;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  objective: string;
}): Promise<string | null> {
  throw new Error("recordGoalLedgerStart: not implemented");
}

export async function recordGoalLedgerEvent(_input: {
  goalId: string;
  userId: string;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  throw new Error("recordGoalLedgerEvent: not implemented");
}

export async function recordGoalLedgerClose(_input: {
  goalId: string;
  terminalStatus: string;
}): Promise<void> {
  throw new Error("recordGoalLedgerClose: not implemented");
}
