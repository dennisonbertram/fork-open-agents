import "server-only";

import { and, asc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { workflowGoalEvents, workflowGoals } from "./schema";
import type {
  NewWorkflowGoal,
  NewWorkflowGoalEvent,
  WorkflowGoal,
  WorkflowGoalEvent,
  WorkflowGoalPlan,
} from "./schema";

// ---------------------------------------------------------------------------
// Terminal-status constants
// ---------------------------------------------------------------------------

/**
 * Terminal goal statuses — states from which no further progression is
 * expected. Transition-validity enforcement (preventing movement OUT of a
 * terminal state) is deferred to issue #38. The `closeGoal` helper documents
 * this invariant by accepting only terminal statuses.
 */
export const TERMINAL_GOAL_STATUSES = [
  "complete",
  "failed",
  "canceled",
  "archived",
] as const;

export type TerminalGoalStatus = (typeof TERMINAL_GOAL_STATUSES)[number];

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `closeGoal` when given a non-terminal status, and by
 * `createGoal` when the objective is empty.
 */
export class GoalLedgerError extends Error {
  readonly code: "non_terminal_status" | "invalid_input";

  constructor(code: "non_terminal_status" | "invalid_input", message: string) {
    super(message);
    this.name = "GoalLedgerError";
    this.code = code;
  }
}

/** Convenience alias used in tests for the invalid-input case. */
export const InvalidGoalInputError = GoalLedgerError;
/** Convenience alias used in tests for the non-terminal-status case. */
export const NonTerminalStatusError = GoalLedgerError;

// ---------------------------------------------------------------------------
// createGoal
// ---------------------------------------------------------------------------

export type CreateGoalInput = {
  userId: string;
  objective: string;
  workflowRunId?: string | null;
  sessionId?: string | null;
  chatId?: string | null;
  status?: NewWorkflowGoal["status"];
  plan?: WorkflowGoalPlan | null;
  blockedReason?: string | null;
  evidenceRefs?: string[];
};

/**
 * Insert a new workflow_goals row.
 *
 * - Generates a nanoid as the id.
 * - Defaults status to "draft" if not provided.
 * - Defaults evidenceRefs to [] if not provided.
 * - Throws GoalLedgerError (code: "invalid_input") when objective is empty.
 */
export async function createGoal(
  input: CreateGoalInput,
): Promise<WorkflowGoal> {
  if (!input.objective || input.objective.trim().length === 0) {
    throw new GoalLedgerError(
      "invalid_input",
      "createGoal requires a non-empty objective.",
    );
  }

  const now = new Date();
  const values: NewWorkflowGoal = {
    id: nanoid(),
    userId: input.userId,
    workflowRunId: input.workflowRunId ?? null,
    sessionId: input.sessionId ?? null,
    chatId: input.chatId ?? null,
    objective: input.objective,
    status: input.status ?? "draft",
    plan: input.plan ?? null,
    blockedReason: input.blockedReason ?? null,
    evidenceRefs: input.evidenceRefs ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const [row] = await db.insert(workflowGoals).values(values).returning();
  return row;
}

// ---------------------------------------------------------------------------
// appendGoalEvent
// ---------------------------------------------------------------------------

export type AppendGoalEventInput = {
  goalId: string;
  userId: string;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
};

/**
 * Append a new ledger entry to a goal.
 *
 * The sequence number is computed as max(sequence)+1 for the goal (starting
 * at 1 for the first event). The select + insert are wrapped in a transaction
 * to avoid races.
 */
export async function appendGoalEvent(
  input: AppendGoalEventInput,
): Promise<WorkflowGoalEvent> {
  return db.transaction(async (tx) => {
    // Compute next sequence: max(sequence) for this goal, defaulting to 0
    const [maxRow] = await tx
      .select({ maxSeq: max(workflowGoalEvents.sequence) })
      .from(workflowGoalEvents)
      .where(eq(workflowGoalEvents.goalId, input.goalId));

    const nextSequence = (maxRow?.maxSeq ?? 0) + 1;

    const values: NewWorkflowGoalEvent = {
      id: nanoid(),
      goalId: input.goalId,
      userId: input.userId,
      sequence: nextSequence,
      eventType: input.eventType,
      summary: input.summary,
      payload: input.payload ?? {},
    };

    const [row] = await tx
      .insert(workflowGoalEvents)
      .values(values)
      .returning();
    return row;
  });
}

// ---------------------------------------------------------------------------
// listGoals
// ---------------------------------------------------------------------------

export type ListGoalsFilter = {
  userId?: string;
  workflowRunId?: string;
  sessionId?: string;
  chatId?: string;
};

/**
 * List workflow_goals filtered by one or more dimensions, ordered by
 * createdAt ascending.
 */
export async function listGoals(
  filter: ListGoalsFilter,
): Promise<WorkflowGoal[]> {
  const conditions = [];

  if (filter.userId) {
    conditions.push(eq(workflowGoals.userId, filter.userId));
  }
  if (filter.workflowRunId) {
    conditions.push(eq(workflowGoals.workflowRunId, filter.workflowRunId));
  }
  if (filter.sessionId) {
    conditions.push(eq(workflowGoals.sessionId, filter.sessionId));
  }
  if (filter.chatId) {
    conditions.push(eq(workflowGoals.chatId, filter.chatId));
  }

  if (conditions.length === 0) {
    return db
      .select()
      .from(workflowGoals)
      .orderBy(asc(workflowGoals.createdAt));
  }

  return db
    .select()
    .from(workflowGoals)
    .where(and(...conditions))
    .orderBy(asc(workflowGoals.createdAt));
}

// ---------------------------------------------------------------------------
// listGoalEvents
// ---------------------------------------------------------------------------

/**
 * List all ledger events for a goal, ordered by sequence ascending.
 */
export async function listGoalEvents(
  goalId: string,
): Promise<WorkflowGoalEvent[]> {
  return db
    .select()
    .from(workflowGoalEvents)
    .where(eq(workflowGoalEvents.goalId, goalId))
    .orderBy(asc(workflowGoalEvents.sequence));
}

// ---------------------------------------------------------------------------
// closeGoal
// ---------------------------------------------------------------------------

/**
 * Transition a goal to a terminal status and bump updatedAt.
 *
 * Throws GoalLedgerError (code: "non_terminal_status") if the provided status
 * is not in TERMINAL_GOAL_STATUSES. Transition-validity enforcement
 * (preventing movement out of an already-terminal state) is deferred to #38.
 */
export async function closeGoal(
  goalId: string,
  terminalStatus: TerminalGoalStatus,
): Promise<WorkflowGoal> {
  if (!(TERMINAL_GOAL_STATUSES as readonly string[]).includes(terminalStatus)) {
    throw new GoalLedgerError(
      "non_terminal_status",
      `closeGoal requires a terminal status. "${terminalStatus}" is not in TERMINAL_GOAL_STATUSES (${TERMINAL_GOAL_STATUSES.join(", ")}).`,
    );
  }

  const [row] = await db
    .update(workflowGoals)
    .set({ status: terminalStatus, updatedAt: new Date() })
    .where(eq(workflowGoals.id, goalId))
    .returning();

  return row;
}
