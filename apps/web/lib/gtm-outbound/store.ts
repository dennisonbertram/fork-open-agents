import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  gtmAccounts,
  gtmApprovals,
  gtmContacts,
  gtmEvents,
  gtmTouchpoints,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "@/lib/gtm/events";
import { redactGtmPayload, redactGtmText } from "@/lib/gtm/redaction";
import { evaluateGtmOutboundPolicy } from "./policy";
import type {
  CreateGtmOutboundDraftResult,
  GtmOutboundDraftInput,
} from "./types";
import { GtmOutboundError } from "./types";

type GtmOutboundDatabase = typeof db;
type GtmOutboundQueryExecutor = Pick<typeof db, "select">;

function hashOutboundBody(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function assertOwnedOutboundTargets(
  tx: GtmOutboundQueryExecutor,
  input: GtmOutboundDraftInput,
) {
  if (input.accountId) {
    const [account] = await tx
      .select({ id: gtmAccounts.id })
      .from(gtmAccounts)
      .where(
        and(
          eq(gtmAccounts.id, input.accountId),
          eq(gtmAccounts.userId, input.userId),
        ),
      );
    if (!account) {
      throw new GtmOutboundError(
        "cross_user_reference",
        "Outbound account does not belong to the requesting user.",
      );
    }
  }

  if (input.contactId) {
    const [contact] = await tx
      .select({ id: gtmContacts.id })
      .from(gtmContacts)
      .where(
        and(
          eq(gtmContacts.id, input.contactId),
          eq(gtmContacts.userId, input.userId),
        ),
      );
    if (!contact) {
      throw new GtmOutboundError(
        "cross_user_reference",
        "Outbound contact does not belong to the requesting user.",
      );
    }
  }
}

export async function createGtmOutboundDraft(
  input: GtmOutboundDraftInput,
  database: GtmOutboundDatabase = db,
): Promise<CreateGtmOutboundDraftResult> {
  if (
    !input.userId.trim() ||
    !input.requestId.trim() ||
    !input.subject.trim() ||
    !input.body.trim()
  ) {
    throw new GtmOutboundError(
      "invalid_outbound_input",
      "Outbound draft requires userId, requestId, subject, and body.",
    );
  }

  const policy = evaluateGtmOutboundPolicy({
    actionKind: input.actionKind,
    recipientDomain: input.recipientDomain,
    allowedDomains: input.allowedDomains,
    approvalStatus: null,
  });

  if (policy.reason === "domain_not_allowed") {
    throw new GtmOutboundError(
      "approval_required",
      "Outbound recipient domain is outside the allowed policy scope.",
    );
  }

  return database.transaction(async (tx) => {
    await assertOwnedOutboundTargets(tx, input);

    const now = new Date();
    const touchpointId = crypto.randomUUID();
    const bodyPreview = redactGtmText(input.body, 320) ?? "";
    const subjectPreview = redactGtmText(input.subject, 160) ?? "Outbound";
    const [touchpoint] = await tx
      .insert(gtmTouchpoints)
      .values({
        id: touchpointId,
        userId: input.userId,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        channel: "email",
        direction: "outbound",
        status: "pending_approval",
        summary: input.summary?.trim() || subjectPreview,
        bodyPreview,
        evidenceRefs: input.evidenceRefs ?? [],
        metadata: redactGtmPayload({
          ...input.metadata,
          actionKind: policy.actionKind,
          subjectPreview,
          bodyHash: hashOutboundBody(input.body),
          recipientHash: input.recipientHash ?? null,
          policy: policy.policySnapshot,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!touchpoint) {
      throw new GtmOutboundError(
        "persistence_failed",
        "Outbound touchpoint insert failed.",
      );
    }

    const approvalId = crypto.randomUUID();
    const [approval] = await tx
      .insert(gtmApprovals)
      .values({
        id: approvalId,
        userId: input.userId,
        actionKind: policy.actionKind,
        targetKind: "touchpoint",
        targetId: touchpoint.id,
        status: "pending",
        requestId: input.requestId,
        requestedBy: "gtm_agent",
        policySnapshot: policy.policySnapshot,
        redactedPreview: redactGtmPayload({
          subject: input.subject,
          bodyPreview,
          summary: input.summary ?? null,
          recipientHash: input.recipientHash ?? null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!approval) {
      throw new GtmOutboundError(
        "persistence_failed",
        "Outbound approval insert failed.",
      );
    }

    const [touchpointEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.touchpoint.recorded",
          entityKind: "touchpoint",
          entityId: touchpoint.id,
          status: "blocked",
          level: "warn",
          payload: {
            actionKind: policy.actionKind,
            approvalId: approval.id,
            externalMutationAllowed: false,
          },
        }),
      )
      .returning();

    if (!touchpointEvent) {
      throw new GtmOutboundError(
        "persistence_failed",
        "Outbound touchpoint event insert failed.",
      );
    }

    const [approvalEvent] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.approval.requested",
          entityKind: "approval",
          entityId: approval.id,
          status: "blocked",
          level: "warn",
          payload: {
            actionKind: policy.actionKind,
            targetKind: "touchpoint",
            targetId: touchpoint.id,
            policy: policy.policySnapshot,
          },
        }),
      )
      .returning();

    if (!approvalEvent) {
      throw new GtmOutboundError(
        "persistence_failed",
        "Outbound approval event insert failed.",
      );
    }

    return {
      touchpointId: touchpoint.id,
      approvalId: approval.id,
      status: "pending_approval",
      policy,
    };
  });
}
