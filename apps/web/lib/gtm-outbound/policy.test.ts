import { describe, expect, test } from "bun:test";
import { evaluateGtmOutboundPolicy } from "./policy";

describe("GTM outbound policy", () => {
  test("requires approval before external email sends", () => {
    const decision = evaluateGtmOutboundPolicy({
      actionKind: "email_send",
      recipientDomain: "acme.test",
      allowedDomains: ["acme.test"],
    });

    expect(decision.requiresApproval).toBe(true);
    expect(decision.externalMutationAllowed).toBe(false);
    expect(decision.reason).toBe("pending_approval");
    expect(decision.policySnapshot).toMatchObject({
      actionKind: "email_send",
      approvalStatus: "pending",
      domainAllowed: true,
    });
  });

  test("allows external mutation only after approval and domain match", () => {
    const decision = evaluateGtmOutboundPolicy({
      actionKind: "email_create_draft",
      recipientDomain: "Acme.Test",
      allowedDomains: ["acme.test"],
      approvalStatus: "approved",
    });

    expect(decision.externalMutationAllowed).toBe(true);
    expect(decision.reason).toBe("approved");
  });

  test("blocks recipients outside the configured domain scope", () => {
    const decision = evaluateGtmOutboundPolicy({
      actionKind: "crm_sequence_enroll",
      recipientDomain: "example.com",
      allowedDomains: ["acme.test"],
      approvalStatus: "approved",
    });

    expect(decision.externalMutationAllowed).toBe(false);
    expect(decision.reason).toBe("domain_not_allowed");
  });
});
