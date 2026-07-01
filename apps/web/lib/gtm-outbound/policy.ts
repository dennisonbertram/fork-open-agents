import {
  type GtmOutboundActionKind,
  type GtmOutboundPolicyDecision,
} from "./types";

const ACTIONS_REQUIRING_APPROVAL = new Set<GtmOutboundActionKind>([
  "email_create_draft",
  "email_send",
  "crm_note_create",
  "crm_contact_update",
  "crm_sequence_enroll",
]);

export interface EvaluateGtmOutboundPolicyInput {
  actionKind?: GtmOutboundActionKind;
  recipientDomain?: string | null;
  allowedDomains?: string[];
  approvalStatus?: "pending" | "approved" | "denied" | "expired" | null;
}

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase();
  return domain || null;
}

export function evaluateGtmOutboundPolicy(
  input: EvaluateGtmOutboundPolicyInput,
): GtmOutboundPolicyDecision {
  const actionKind = input.actionKind ?? "email_send";
  const recipientDomain = normalizeDomain(input.recipientDomain);
  const allowedDomains = (input.allowedDomains ?? [])
    .map((domain) => normalizeDomain(domain))
    .filter((domain): domain is string => domain !== null);
  const domainAllowed =
    !recipientDomain ||
    allowedDomains.length === 0 ||
    allowedDomains.includes(recipientDomain);
  const requiresApproval = ACTIONS_REQUIRING_APPROVAL.has(actionKind);
  const approved = input.approvalStatus === "approved";

  return {
    actionKind,
    requiresApproval,
    externalMutationAllowed: requiresApproval && approved && domainAllowed,
    reason: domainAllowed
      ? approved
        ? "approved"
        : "pending_approval"
      : "domain_not_allowed",
    policySnapshot: {
      actionKind,
      requiresApproval,
      approvalStatus: input.approvalStatus ?? "pending",
      recipientDomain,
      allowedDomains,
      domainAllowed,
      externalMutationAllowed: requiresApproval && approved && domainAllowed,
    },
  };
}
