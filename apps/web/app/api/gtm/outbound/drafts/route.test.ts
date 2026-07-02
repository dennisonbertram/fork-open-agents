import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmOutboundError } from "@/lib/gtm-outbound/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const createGtmOutboundDraft = mock(async () => ({
  touchpointId: "touchpoint-1",
  approvalId: "approval-1",
  status: "pending_approval",
  policy: {
    actionKind: "email_send",
    requiresApproval: true,
    externalMutationAllowed: false,
    reason: "pending_approval",
    policySnapshot: {},
  },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-outbound/store", () => ({
  createGtmOutboundDraft,
}));

const routeModulePromise = import("./route");

describe("POST /api/gtm/outbound/drafts", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createGtmOutboundDraft.mockClear();
    createGtmOutboundDraft.mockResolvedValue({
      touchpointId: "touchpoint-1",
      approvalId: "approval-1",
      status: "pending_approval",
      policy: {
        actionKind: "email_send",
        requiresApproval: true,
        externalMutationAllowed: false,
        reason: "pending_approval",
        policySnapshot: {},
      },
    });
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/outbound/drafts", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(createGtmOutboundDraft).not.toHaveBeenCalled();
  });

  test("creates a pending outbound draft with an explicit request id", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/outbound/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-1",
        },
        body: JSON.stringify({
          accountId: "account-1",
          contactId: "contact-1",
          actionKind: "email_create_draft",
          subject: "Intro",
          body: "Hello",
          recipientHash: "recipient-hash",
          recipientDomain: "acme.test",
          allowedDomains: ["acme.test"],
          evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.approvalId).toBe("approval-1");
    expect(createGtmOutboundDraft).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "req-1",
      accountId: "account-1",
      contactId: "contact-1",
      actionKind: "email_create_draft",
      subject: "Intro",
      body: "Hello",
      summary: null,
      recipientHash: "recipient-hash",
      recipientDomain: "acme.test",
      allowedDomains: ["acme.test"],
      evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
      metadata: {},
    });
  });

  test("returns typed errors without external mutations", async () => {
    createGtmOutboundDraft.mockRejectedValue(
      new GtmOutboundError(
        "approval_required",
        "Outbound recipient domain is outside the allowed policy scope.",
      ),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/outbound/drafts", {
        method: "POST",
        body: JSON.stringify({
          subject: "Intro",
          body: "Hello",
          recipientDomain: "other.test",
          allowedDomains: ["acme.test"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("approval_required");
  });
});
