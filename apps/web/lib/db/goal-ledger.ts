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
 * Thrown by goal-ledger helpers for all typed error conditions.
 *
 * Codes:
 *   - "invalid_input"               — caller provided invalid arguments (e.g. empty objective, no filter)
 *   - "non_terminal_status"         — closeGoal received a status that is not in TERMINAL_GOAL_STATUSES
 *   - "not_found"                   — the target row did not exist (e.g. closeGoal on missing id, appendGoalEvent on missing goal)
 *   - "persist_failed"              — an insert/update returned no row unexpectedly (DB-level failure)
 *   - "invalid_terminal_transition" — closeGoal was called on a goal that is already in a terminal
 *                                     state; transitions OUT of terminal states are forbidden (#38).
 */
export class GoalLedgerError extends Error {
  readonly code:
    | "non_terminal_status"
    | "invalid_input"
    | "not_found"
    | "persist_failed"
    | "invalid_terminal_transition";

  constructor(
    code:
      | "non_terminal_status"
      | "invalid_input"
      | "not_found"
      | "persist_failed"
      | "invalid_terminal_transition",
    message: string,
  ) {
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
 * - Throws GoalLedgerError (code: "persist_failed") when the insert returns no row.
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

  if (row === undefined) {
    throw new GoalLedgerError(
      "persist_failed",
      "createGoal: insert returned no row — unexpected persistence failure.",
    );
  }

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
 * Locking strategy: the parent goal row is locked with SELECT ... FOR UPDATE
 * before computing max(sequence)+1. This serializes concurrent appends per
 * goal — two concurrent calls will queue behind the lock rather than racing
 * to compute the same sequence number. The unique (goalId, sequence) index on
 * workflow_goal_events is the final backstop: if the lock is somehow bypassed
 * (e.g. non-Postgres driver, test environment), a duplicate sequence insert
 * will throw a unique-violation that callers should treat as a retriable error.
 *
 * - Throws GoalLedgerError (code: "not_found") when the parent goal does not exist.
 * - Throws GoalLedgerError (code: "persist_failed") when the insert returns no row.
 */
export async function appendGoalEvent(
  input: AppendGoalEventInput,
): Promise<WorkflowGoalEvent> {
  return db.transaction(async (tx) => {
    // Acquire a row lock on the parent goal to serialize concurrent appends.
    // This prevents two transactions from computing the same max(sequence)+1.
    const [goalRow] = await tx
      .select()
      .from(workflowGoals)
      .where(eq(workflowGoals.id, input.goalId))
      .for("update");

    if (goalRow === undefined) {
      throw new GoalLedgerError(
        "not_found",
        `appendGoalEvent: goal "${input.goalId}" not found.`,
      );
    }

    // Compute next sequence: max(sequence) for this goal, defaulting to 0.
    // The FOR UPDATE lock above ensures no other transaction can insert a
    // competing event row between here and our insert below.
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

    if (row === undefined) {
      throw new GoalLedgerError(
        "persist_failed",
        "appendGoalEvent: insert returned no row — unexpected persistence failure.",
      );
    }

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
 *
 * At least one filter condition must be provided. Calling listGoals({}) with
 * no filters is rejected to prevent unbounded multi-tenant scans.
 * Throws GoalLedgerError (code: "invalid_input") when no filter is provided.
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
    throw new GoalLedgerError(
      "invalid_input",
      "listGoals requires at least one filter (e.g. userId). Unfiltered queries are rejected to prevent multi-tenant data exposure.",
    );
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
 * Locking strategy: the goal row is locked with SELECT ... FOR UPDATE before
 * inspecting and updating its status. This serializes concurrent close calls
 * per goal — two concurrent calls will queue behind the lock rather than
 * racing to read/write the same status, mirroring the locking strategy used
 * in `appendGoalEvent`.
 *
 * - Throws GoalLedgerError (code: "non_terminal_status") if the provided
 *   status is not in TERMINAL_GOAL_STATUSES.
 * - Throws GoalLedgerError (code: "not_found") if the goal row does not exist.
 * - Throws GoalLedgerError (code: "invalid_terminal_transition") if the goal
 *   is already in a terminal state; transitions out of terminal states are
 *   forbidden (#38). This prevents double-close and ensures terminal states
 *   are immutable.
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

  return db.transaction(async (tx) => {
    // Acquire a row lock on the goal to prevent concurrent close calls from
    // racing to read and update the same status simultaneously.
    const [currentRow] = await tx
      .select()
      .from(workflowGoals)
      .where(eq(workflowGoals.id, goalId))
      .for("update");

    if (currentRow === undefined) {
      throw new GoalLedgerError(
        "not_found",
        `closeGoal: goal "${goalId}" not found.`,
      );
    }

    // Reject transitions out of already-terminal states (#38).
    if (
      (TERMINAL_GOAL_STATUSES as readonly string[]).includes(currentRow.status)
    ) {
      throw new GoalLedgerError(
        "invalid_terminal_transition",
        `closeGoal: goal "${goalId}" is already terminal ("${currentRow.status}"); cannot transition to "${terminalStatus}".`,
      );
    }

    const [row] = await tx
      .update(workflowGoals)
      .set({ status: terminalStatus, updatedAt: new Date() })
      .where(eq(workflowGoals.id, goalId))
      .returning();

    if (row === undefined) {
      throw new GoalLedgerError(
        "persist_failed",
        `closeGoal: update for goal "${goalId}" returned no row — unexpected persistence failure.`,
      );
    }

    return row;
  });
}
