import "server-only";

import { nanoid } from "nanoid";
import { db } from "./client";
import { workflowInputSnapshots } from "./schema";

// ── Typed error class ──────────────────────────────────────────────────────

/**
 * Thrown by workflow-input-snapshot helpers for typed error conditions.
 *
 * Codes:
 *   - "persist_failed" — the DB insert failed (constraint violation, connectivity, etc.)
 */
export class WorkflowInputSnapshotError extends Error {
  readonly code: "persist_failed";

  constructor(code: "persist_failed", message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
    this.name = "WorkflowInputSnapshotError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PersistWorkflowInputSnapshotInput = {
  workflowRunId: string;
  workflowId?: string | null;
  schemaVersion?: string | null;
  /** Input values with all sensitive fields already replaced by "[REDACTED]". */
  inputValues: Record<string, unknown>;
  persistedAt: Date;
};

// ── DB access function ─────────────────────────────────────────────────────

/**
 * Persists an immutable workflow input snapshot row.
 *
 * The caller is responsible for redacting sensitive fields BEFORE calling this
 * function — inputValues must never contain raw secret values.
 *
 * Returns the generated snapshot id on success.
 * Uses onConflictDoNothing for idempotency (unique index on workflowRunId).
 * NEVER throws — caller catches and maps to WorkflowInputSnapshotError.
 */
export async function persistWorkflowInputSnapshot(
  input: PersistWorkflowInputSnapshotInput,
): Promise<string> {
  const id = nanoid();

  await db
    .insert(workflowInputSnapshots)
    .values({
      id,
      workflowRunId: input.workflowRunId,
      workflowId: input.workflowId ?? null,
      schemaVersion: input.schemaVersion ?? null,
      inputValues: input.inputValues,
      persistedAt: input.persistedAt,
    })
    .onConflictDoNothing({ target: workflowInputSnapshots.workflowRunId });

  return id;
}
