export type GtmApprovalDecision = "approved" | "denied";

export type GtmApprovalDecisionErrorKind =
  | "invalid_approval_input"
  | "approval_not_found"
  | "approval_already_decided"
  | "persistence_failed";

export class GtmApprovalDecisionError extends Error {
  readonly kind: GtmApprovalDecisionErrorKind;

  constructor(kind: GtmApprovalDecisionErrorKind, message: string) {
    super(message);
    this.name = "GtmApprovalDecisionError";
    this.kind = kind;
  }
}

export interface DecideGtmApprovalInput {
  userId: string;
  approvalId: string;
  requestId: string;
  decision: GtmApprovalDecision;
  decidedBy?: string | null;
}

export interface DecideGtmApprovalResult {
  approvalId: string;
  status: GtmApprovalDecision;
  targetKind: string;
  targetId: string;
  actionKind: string;
  decidedAt: string;
}
