import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gtmApprovals, gtmEvents } from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import type { DecideGtmApprovalInput, DecideGtmApprovalResult } from "./types";
import { GtmApprovalDecisionError } from "./types";

type GtmApprovalDatabase = typeof db;

export async function decideGtmApproval(
  input: DecideGtmApprovalInput,
  database: GtmApprovalDatabase = db,
): Promise<DecideGtmApprovalResult> {
  if (
    !input.userId.trim() ||
    !input.approvalId.trim() ||
    !input.requestId.trim()
  ) {
    throw new GtmApprovalDecisionError(
      "invalid_approval_input",
      "Approval decision requires userId, approvalId, and requestId.",
    );
  }

  return database.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(gtmApprovals)
      .where(
        and(
          eq(gtmApprovals.userId, input.userId),
          eq(gtmApprovals.id, input.approvalId),
        ),
      );

    if (!approval) {
      throw new GtmApprovalDecisionError(
        "approval_not_found",
        "GTM approval was not found for this user.",
      );
    }

    if (approval.status !== "pending") {
      throw new GtmApprovalDecisionError(
        "approval_already_decided",
        "GTM approval has already been decided.",
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(gtmApprovals)
      .set({
        status: input.decision,
        decidedBy: input.decidedBy ?? input.userId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(gtmApprovals.userId, input.userId),
          eq(gtmApprovals.id, approval.id),
          eq(gtmApprovals.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      throw new GtmApprovalDecisionError(
        "approval_already_decided",
        "GTM approval has already been decided.",
      );
    }

    const [event] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.approval.decided",
          entityKind: "approval",
          entityId: updated.id,
          status: input.decision === "approved" ? "succeeded" : "blocked",
          level: input.decision === "approved" ? "info" : "warn",
          payload: {
            actionKind: updated.actionKind,
            targetKind: updated.targetKind,
            targetId: updated.targetId,
            decision: input.decision,
          },
        }),
      )
      .returning();

    if (!event) {
      throw new GtmApprovalDecisionError(
        "persistence_failed",
        "GTM approval decision event insert failed.",
      );
    }

    return {
      approvalId: updated.id,
      status: input.decision,
      targetKind: updated.targetKind,
      targetId: updated.targetId,
      actionKind: updated.actionKind,
      decidedAt: now.toISOString(),
    };
  });
}
