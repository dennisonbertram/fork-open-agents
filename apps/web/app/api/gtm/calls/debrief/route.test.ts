import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmCallError } from "@/lib/gtm-call/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const createGtmCallDebrief = mock(async () => ({
  callId: "call-1",
  runId: "run-1",
  debrief: {
    summary: "Summary",
    sentiment: "neutral",
    attendees: [],
    nextSteps: [],
    objections: [],
    productAsks: [],
    followUpDraft: { subject: "Follow-up", bodyPreview: "Preview" },
    proposedActions: [],
  },
  insightIds: [],
  approvalIds: ["approval-1"],
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-call/store", () => ({
  createGtmCallDebrief,
}));

const routeModulePromise = import("./route");

describe("POST /api/gtm/calls/debrief", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createGtmCallDebrief.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/debrief", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(createGtmCallDebrief).not.toHaveBeenCalled();
  });

  test("creates a call debrief with pending approval actions", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/debrief", {
        method: "POST",
        headers: { "x-request-id": "req-1" },
        body: JSON.stringify({
          accountId: "account-1",
          contactId: "contact-1",
          callId: "call-1",
          notes: "Next send plan.",
          attendees: ["Morgan"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.approvalIds).toEqual(["approval-1"]);
    expect(createGtmCallDebrief).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "req-1",
      accountId: "account-1",
      contactId: "contact-1",
      callId: "call-1",
      notes: "Next send plan.",
      attendees: ["Morgan"],
      evidenceRefs: [],
    });
  });

  test("returns typed debrief errors", async () => {
    createGtmCallDebrief.mockRejectedValue(
      new GtmCallError("transcript_too_large", "Too large"),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/debrief", {
        method: "POST",
        body: JSON.stringify({ notes: "x" }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
