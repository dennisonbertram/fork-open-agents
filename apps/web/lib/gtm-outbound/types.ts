import type { GtmEvidenceRef } from "@/lib/gtm/types";

export type GtmOutboundActionKind =
  | "email_create_draft"
  | "email_send"
  | "crm_note_create"
  | "crm_contact_update"
  | "crm_sequence_enroll";

export type GtmOutboundErrorKind =
  | "invalid_outbound_input"
  | "approval_required"
  | "cross_user_reference"
  | "persistence_failed";

export class GtmOutboundError extends Error {
  readonly kind: GtmOutboundErrorKind;

  constructor(kind: GtmOutboundErrorKind, message: string) {
    super(message);
    this.name = "GtmOutboundError";
    this.kind = kind;
  }
}

export interface GtmOutboundDraftInput {
  userId: string;
  requestId: string;
  accountId?: string | null;
  contactId?: string | null;
  actionKind?: GtmOutboundActionKind;
  subject: string;
  body: string;
  summary?: string | null;
  recipientHash?: string | null;
  recipientDomain?: string | null;
  allowedDomains?: string[];
  evidenceRefs?: GtmEvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface GtmOutboundPolicyDecision {
  actionKind: GtmOutboundActionKind;
  requiresApproval: boolean;
  externalMutationAllowed: boolean;
  reason: "pending_approval" | "approved" | "domain_not_allowed";
  policySnapshot: Record<string, unknown>;
}

export interface CreateGtmOutboundDraftResult {
  touchpointId: string;
  approvalId: string;
  status: "pending_approval";
  policy: GtmOutboundPolicyDecision;
}
