// Stub — implementation pending (goal-ledger TDD red phase)
export const TERMINAL_GOAL_STATUSES = [] as const;
export type TerminalGoalStatus = never;

export async function createGoal(_input: never): Promise<never> {
  throw new Error("not implemented");
}

export async function appendGoalEvent(_input: never): Promise<never> {
  throw new Error("not implemented");
}

export async function listGoalEvents(_goalId: never): Promise<never[]> {
  throw new Error("not implemented");
}

export async function listGoals(_filter: never): Promise<never[]> {
  throw new Error("not implemented");
}

export async function closeGoal(
  _goalId: never,
  _status: never,
): Promise<never> {
  throw new Error("not implemented");
}
