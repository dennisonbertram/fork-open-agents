import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmApprovalDecisionError } from "@/lib/gtm-approvals/types";

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
const decideGtmApproval = mock(async () => ({
  approvalId: "approval-1",
  status: "approved",
  targetKind: "touchpoint",
  targetId: "touchpoint-1",
  actionKind: "email_send",
  decidedAt: "2026-07-01T00:00:00.000Z",
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-approvals/store", () => ({
  decideGtmApproval,
}));

const routeModulePromise = import("./route");

describe("PATCH /api/gtm/approvals/[approvalId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    decideGtmApproval.mockClear();
    decideGtmApproval.mockResolvedValue({
      approvalId: "approval-1",
      status: "approved",
      targetKind: "touchpoint",
      targetId: "touchpoint-1",
      actionKind: "email_send",
      decidedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/gtm/approvals/approval-1", {
        method: "PATCH",
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ approvalId: "approval-1" }) },
    );

    expect(response.status).toBe(401);
    expect(decideGtmApproval).not.toHaveBeenCalled();
  });

  test("records an approval decision with request correlation", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/gtm/approvals/approval-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-1",
        },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ approvalId: "approval-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("approved");
    expect(decideGtmApproval).toHaveBeenCalledWith({
      userId: "user-1",
      approvalId: "approval-1",
      requestId: "req-1",
      decision: "approved",
      decidedBy: "user-1",
    });
  });

  test("rejects invalid decisions", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/gtm/approvals/approval-1", {
        method: "PATCH",
        body: JSON.stringify({ decision: "maybe" }),
      }),
      { params: Promise.resolve({ approvalId: "approval-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_approval_input");
    expect(decideGtmApproval).not.toHaveBeenCalled();
  });

  test("rejects null request bodies", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/gtm/approvals/approval-1", {
        method: "PATCH",
        body: "null",
      }),
      { params: Promise.resolve({ approvalId: "approval-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_approval_input");
    expect(decideGtmApproval).not.toHaveBeenCalled();
  });

  test("returns typed errors", async () => {
    decideGtmApproval.mockRejectedValue(
      new GtmApprovalDecisionError(
        "approval_already_decided",
        "GTM approval has already been decided.",
      ),
    );
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/gtm/approvals/approval-1", {
        method: "PATCH",
        body: JSON.stringify({ decision: "denied" }),
      }),
      { params: Promise.resolve({ approvalId: "approval-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errorKind).toBe("approval_already_decided");
  });
});
