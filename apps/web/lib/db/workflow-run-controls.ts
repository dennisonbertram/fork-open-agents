import "server-only";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
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
 * (workflowRunId, idempotencyKey) unique index for idempotency.
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
      target: [
        workflowRunControls.workflowRunId,
        workflowRunControls.idempotencyKey,
      ],
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
};

/**
 * In-place UPDATE of the control row status and related fields.
 */
export async function updateRunControlStatus(
  workflowRunId: string,
  updates: UpdateRunControlStatusInput,
): Promise<RunControlRow | null> {
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
    .where(eq(workflowRunControls.workflowRunId, workflowRunId))
    .returning();

  return rows[0] ?? null;
}
