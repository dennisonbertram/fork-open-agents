import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ARTIFACT_KINDS,
  ARTIFACT_REDACTION_STATUSES,
  ARTIFACT_STATUSES,
  type WorkflowArtifactInsert,
  type WorkflowArtifactKind,
  type WorkflowArtifactRedactionStatus,
  type WorkflowArtifactStatus,
  workflowArtifactInsertSchema,
} from "../workflows/artifacts";
import { db } from "./client";
import { type WorkflowArtifact, workflowArtifacts } from "./schema";

// ---------------------------------------------------------------------------
// Typed error class
// ---------------------------------------------------------------------------

export class WorkflowArtifactError extends Error {
  code: "invalid_artifact" | "not_found";

  constructor(code: "invalid_artifact" | "not_found", message: string) {
    super(message);
    this.name = "WorkflowArtifactError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// createArtifact
// ---------------------------------------------------------------------------

export async function createArtifact(
  input: WorkflowArtifactInsert,
): Promise<WorkflowArtifact> {
  const parsed = workflowArtifactInsertSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowArtifactError(
      "invalid_artifact",
      `Invalid artifact input: ${parsed.error.message}`,
    );
  }

  const data = parsed.data;
  const now = new Date();

  const [row] = await db
    .insert(workflowArtifacts)
    .values({
      id: nanoid(),
      kind: data.kind,
      status: data.status ?? "expected",
      redactionStatus: data.redactionStatus ?? "pending",
      sourceLocation: data.sourceLocation ?? null,
      summary: data.summary ?? null,
      createdByActor: data.createdByActor ?? null,
      workflowRunId: data.workflowRunId ?? null,
      sessionId: data.sessionId ?? null,
      chatId: data.chatId ?? null,
      goalId: data.goalId ?? null,
      gateId: data.gateId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new WorkflowArtifactError(
      "invalid_artifact",
      "Insert returned no row",
    );
  }

  return row;
}

// ---------------------------------------------------------------------------
// getArtifact
// ---------------------------------------------------------------------------

export async function getArtifact(id: string): Promise<WorkflowArtifact> {
  const rows = await db
    .select()
    .from(workflowArtifacts)
    .where(eq(workflowArtifacts.id, id))
    .orderBy(asc(workflowArtifacts.createdAt));

  const [row] = rows;
  if (!row) {
    throw new WorkflowArtifactError(
      "not_found",
      `Workflow artifact not found: ${id}`,
    );
  }

  return row;
}

// ---------------------------------------------------------------------------
// listArtifacts — requires ≥1 filter (no full-table scan)
// ---------------------------------------------------------------------------

export type ListArtifactsFilter = {
  workflowRunId?: string;
  sessionId?: string;
  chatId?: string;
  kind?: WorkflowArtifactKind;
};

export async function listArtifacts(
  filter: ListArtifactsFilter,
): Promise<WorkflowArtifact[]> {
  const { workflowRunId, sessionId, chatId, kind } = filter;

  // Multi-tenant safety: require at least one scoping filter to prevent
  // accidental full-table scans (mirrors goal-ledger's listGoals guard).
  if (!workflowRunId && !sessionId && !chatId && !kind) {
    throw new WorkflowArtifactError(
      "invalid_artifact",
      "listArtifacts requires at least one filter (workflowRunId, sessionId, chatId, or kind)",
    );
  }

  const conditions = [
    workflowRunId
      ? eq(workflowArtifacts.workflowRunId, workflowRunId)
      : undefined,
    sessionId ? eq(workflowArtifacts.sessionId, sessionId) : undefined,
    chatId ? eq(workflowArtifacts.chatId, chatId) : undefined,
    kind ? eq(workflowArtifacts.kind, kind) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  return db
    .select()
    .from(workflowArtifacts)
    .where(and(...conditions))
    .orderBy(asc(workflowArtifacts.createdAt));
}

// ---------------------------------------------------------------------------
// updateArtifactStatus
// ---------------------------------------------------------------------------

export async function updateArtifactStatus(
  id: string,
  status: WorkflowArtifactStatus,
): Promise<WorkflowArtifact> {
  const [row] = await db
    .update(workflowArtifacts)
    .set({ status, updatedAt: new Date() })
    .where(eq(workflowArtifacts.id, id))
    .returning();

  if (!row) {
    throw new WorkflowArtifactError(
      "not_found",
      `Workflow artifact not found for status update: ${id}`,
    );
  }

  return row;
}

// ---------------------------------------------------------------------------
// setArtifactRedactionStatus
// ---------------------------------------------------------------------------

export async function setArtifactRedactionStatus(
  id: string,
  redactionStatus: WorkflowArtifactRedactionStatus,
): Promise<WorkflowArtifact> {
  const [row] = await db
    .update(workflowArtifacts)
    .set({ redactionStatus, updatedAt: new Date() })
    .where(eq(workflowArtifacts.id, id))
    .returning();

  if (!row) {
    throw new WorkflowArtifactError(
      "not_found",
      `Workflow artifact not found for redaction status update: ${id}`,
    );
  }

  return row;
}

// Re-export enums for convenience — callers can import from here without
// reaching into the workflows layer directly.
export {
  ARTIFACT_KINDS,
  ARTIFACT_REDACTION_STATUSES,
  ARTIFACT_STATUSES,
} from "../workflows/artifacts";
