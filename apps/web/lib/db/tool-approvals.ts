/**
 * Parked tool approval persistence module.
 *
 * Provides three operations:
 *   - parkToolApproval: insert a new pending approval record
 *   - getToolApproval: retrieve a record by approvalId
 *   - consumeToolApproval: atomic compare-and-set idempotency guard
 *
 * The consumeToolApproval function uses an atomic UPDATE … WHERE consumed=false
 * RETURNING pattern. If the record has already been consumed (first call already
 * set consumed=true), the RETURNING result is empty and the function returns null.
 * This prevents double-application of an approval or denial decision.
 *
 * Observability: structured console.info events are emitted for park/approve/
 * deny/expire transitions. These are best-effort and never crash the flow.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "./client";
import {
  type NewWorkflowToolApproval,
  type WorkflowToolApproval,
  workflowToolApprovals,
} from "./schema";

// Re-export the inferred types for consumers
export type { WorkflowToolApproval };

export type ToolApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export type ParkToolApprovalInput = Omit<
  NewWorkflowToolApproval,
  "decision" | "consumed" | "createdAt" | "updatedAt" | "expiresAt"
> & {
  expiresAt?: Date | null;
};

// ---------------------------------------------------------------------------
// Observability helpers (best-effort — never throws)
// ---------------------------------------------------------------------------

function emitApprovalEvent(
  event: "parked" | "approved" | "denied" | "expired",
  approvalId: string,
  toolName: string,
  category: string | null | undefined,
): void {
  try {
    console.info("[tool-approval]", event, {
      approvalId,
      toolName,
      category: category ?? null,
    });
  } catch {
    // never crash the caller
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a new pending approval record.
 * Returns the inserted record on success, null if insert returned no rows.
 */
export async function parkToolApproval(
  input: ParkToolApprovalInput,
): Promise<WorkflowToolApproval | null> {
  const [record] = await db
    .insert(workflowToolApprovals)
    .values({
      ...input,
      decision: "pending",
      consumed: false,
    })
    .returning();

  if (!record) return null;

  emitApprovalEvent(
    "parked",
    record.approvalId,
    record.toolName,
    record.category,
  );
  return record;
}

/**
 * Retrieve an approval record by approvalId.
 * Returns null if not found.
 */
export async function getToolApproval(
  approvalId: string,
): Promise<WorkflowToolApproval | null> {
  const [record] = await db
    .select()
    .from(workflowToolApprovals)
    .where(eq(workflowToolApprovals.approvalId, approvalId));

  return record ?? null;
}

/**
 * Atomically consume an approval record by setting consumed=true and recording
 * the decision. The WHERE clause includes consumed=false so a second call
 * (duplicate resume POST) returns an empty RETURNING set → null is returned,
 * preventing double-application of the decision.
 *
 * Returns the updated record on first call, null on subsequent calls.
 */
export async function consumeToolApproval(
  approvalId: string,
  decision: "approved" | "denied" | "expired",
): Promise<WorkflowToolApproval | null> {
  const [record] = await db
    .update(workflowToolApprovals)
    .set({
      decision,
      consumed: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowToolApprovals.approvalId, approvalId),
        eq(workflowToolApprovals.consumed, false),
      ),
    )
    .returning();

  if (!record) return null;

  emitApprovalEvent(
    decision,
    record.approvalId,
    record.toolName,
    record.category,
  );
  return record;
}
