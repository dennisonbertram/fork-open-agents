import "server-only";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { workflowRunControls } from "./schema";

export class WorkflowRunControlError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "WorkflowRunControlError";
    this.code = code;
  }
}

export type RunControlRow = typeof workflowRunControls.$inferSelect;

export type CreateRunControlInput = {
  workflowRunId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  hookToken: string;
  idempotencyKey: string;
};

/**
 * Insert one control row at run-start. Uses onConflictDoNothing on the
 * workflow_run_id unique index for idempotency (one row per run).
 * Re-execution/replay is safe: the same workflowRunId always produces the
 * same insert and the conflict is silently ignored.
 */
export async function createRunControl(
  input: CreateRunControlInput,
): Promise<RunControlRow | null> {
  const rows = await db
    .insert(workflowRunControls)
    .values({
      id: nanoid(),
      workflowRunId: input.workflowRunId,
      chatId: input.chatId,
      sessionId: input.sessionId,
      userId: input.userId,
      status: "running",
      pendingCommandKind: null,
      hookToken: input.hookToken,
      idempotencyKey: input.idempotencyKey,
      commandedBy: null,
      commandedAt: null,
      appliedAt: null,
    })
    .onConflictDoNothing({
      // Target the single-column unique index on workflow_run_id so that
      // re-execution during replay does not insert a second row.
      target: workflowRunControls.workflowRunId,
    })
    .returning();

  return rows[0] ?? null;
}

/**
 * Load the single control row for a run.
 */
export async function getRunControl(
  workflowRunId: string,
): Promise<RunControlRow | null> {
  const rows = await db
    .select()
    .from(workflowRunControls)
    .where(eq(workflowRunControls.workflowRunId, workflowRunId));

  return rows[0] ?? null;
}

export type UpdateRunControlStatusInput = {
  status: RunControlRow["status"];
  pendingCommandKind?: RunControlRow["pendingCommandKind"];
  idempotencyKey?: string;
  commandedBy?: string | null;
  commandedAt?: Date | null;
  appliedAt?: Date | null;
  /**
   * Compare-and-set guard. When provided, the UPDATE only takes effect if the
   * row's current status matches this value. Returns null (0 rows updated) if
   * the guard fails — a concurrent transition already won the race.
   */
  expectedFromStatus?: RunControlRow["status"];
};

/**
 * CAS UPDATE of the control row status and related fields.
 *
 * When `expectedFromStatus` is provided the UPDATE includes a
 * `WHERE status = :expectedFromStatus` guard, making the operation a
 * compare-and-set. Returns null when 0 rows were updated (guard failed).
 * Callers MUST treat a null return as a concurrent-update race loss and
 * re-read the row to produce the correct result (conflict / illegal-transition
 * / idempotent no-op).
 */
export async function updateRunControlStatus(
  workflowRunId: string,
  updates: UpdateRunControlStatusInput,
): Promise<RunControlRow | null> {
  const whereClause =
    updates.expectedFromStatus !== undefined
      ? and(
          eq(workflowRunControls.workflowRunId, workflowRunId),
          eq(workflowRunControls.status, updates.expectedFromStatus),
        )
      : eq(workflowRunControls.workflowRunId, workflowRunId);

  const rows = await db
    .update(workflowRunControls)
    .set({
      status: updates.status,
      pendingCommandKind:
        updates.pendingCommandKind !== undefined
          ? updates.pendingCommandKind
          : undefined,
      idempotencyKey:
        updates.idempotencyKey !== undefined
          ? updates.idempotencyKey
          : undefined,
      commandedBy:
        updates.commandedBy !== undefined ? updates.commandedBy : undefined,
      commandedAt:
        updates.commandedAt !== undefined ? updates.commandedAt : undefined,
      appliedAt:
        updates.appliedAt !== undefined ? updates.appliedAt : undefined,
      updatedAt: new Date(),
    })
    .where(whereClause)
    .returning();

  return rows[0] ?? null;
}
