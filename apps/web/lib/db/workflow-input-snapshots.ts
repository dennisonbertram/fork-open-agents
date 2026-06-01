import "server-only";

import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { workflowInputSnapshots } from "./schema";

// ── Typed error class ──────────────────────────────────────────────────────

/**
 * Thrown by workflow-input-snapshot helpers for typed error conditions.
 *
 * FIX 6: The DB module now actually wraps DB errors in WorkflowInputSnapshotError.
 * Previously it never threw — the caller's instanceof check was dead code.
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
 * FIX 2: workflowRunId must be the REAL run.runId from workflow start — NOT
 * a pre-generated nanoid. The FK to workflow_runs has been dropped (see schema.ts).
 *
 * FIX 5: Uses .returning({ id }) so that on conflict (duplicate workflowRunId),
 * we can detect the empty result and SELECT the existing row's id. This ensures
 * we never return a fabricated nanoid that doesn't correspond to a persisted row.
 *
 * FIX 6: DB errors are wrapped in WorkflowInputSnapshotError and re-thrown,
 * so callers can use instanceof for typed handling.
 *
 * Returns the generated (or existing) snapshot id on success.
 * THROWS WorkflowInputSnapshotError("persist_failed") on DB error.
 */
export async function persistWorkflowInputSnapshot(
  input: PersistWorkflowInputSnapshotInput,
): Promise<string> {
  const id = nanoid();

  try {
    // FIX 5: Use .returning({ id }) so we can detect conflict (empty result)
    const rows = await db
      .insert(workflowInputSnapshots)
      .values({
        id,
        workflowRunId: input.workflowRunId,
        workflowId: input.workflowId ?? null,
        schemaVersion: input.schemaVersion ?? null,
        inputValues: input.inputValues,
        persistedAt: input.persistedAt,
      })
      .onConflictDoNothing({ target: workflowInputSnapshots.workflowRunId })
      .returning({ id: workflowInputSnapshots.id });

    // FIX 5: If rows is empty, a conflict occurred. SELECT the existing row.
    if (rows.length === 0) {
      const existing = await db
        .select({ id: workflowInputSnapshots.id })
        .from(workflowInputSnapshots)
        .where(
          eq(workflowInputSnapshots.workflowRunId, input.workflowRunId),
        );
      if (existing.length > 0 && existing[0]?.id) {
        return existing[0].id;
      }
      // If we can't find the existing row, that's a genuine DB issue
      throw new WorkflowInputSnapshotError(
        "persist_failed",
        "Conflict on workflowRunId but could not retrieve existing snapshot id (field keys: workflowRunId)",
      );
    }

    // FIX 6: rows[0].id is guaranteed by .returning()
    return rows[0]!.id;
  } catch (err) {
    // FIX 6: Wrap in WorkflowInputSnapshotError if not already wrapped
    if (err instanceof WorkflowInputSnapshotError) {
      throw err;
    }
    throw new WorkflowInputSnapshotError(
      "persist_failed",
      "Failed to persist workflow input snapshot (field keys logged only)",
      err,
    );
  }
}
