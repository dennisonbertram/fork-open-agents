import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmCallError } from "@/lib/gtm-call/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const createGtmCallPrep = mock(async () => ({
  callId: "call-1",
  runId: "run-1",
  brief: {
    objective: "Validate fit",
    conciseBrief: "Context",
    risks: [],
    openLoops: [],
    suggestedQuestions: [],
    sourceCount: 1,
  },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-call/store", () => ({
  createGtmCallPrep,
}));

const routeModulePromise = import("./route");

describe("POST /api/gtm/calls/prep", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createGtmCallPrep.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/prep", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(createGtmCallPrep).not.toHaveBeenCalled();
  });

  test("creates a call prep brief with request correlation", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/prep", {
        method: "POST",
        headers: { "x-request-id": "req-1" },
        body: JSON.stringify({
          accountId: "account-1",
          contactId: "contact-1",
          founderObjective: "Validate fit",
          knownContext: ["Prior note"],
          openLoops: ["Budget"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createGtmCallPrep).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "req-1",
      accountId: "account-1",
      contactId: "contact-1",
      founderObjective: "Validate fit",
      knownContext: ["Prior note"],
      openLoops: ["Budget"],
      desiredOutcome: null,
      evidenceRefs: [],
    });
  });

  test("returns typed call errors", async () => {
    createGtmCallPrep.mockRejectedValue(
      new GtmCallError("cross_user_reference", "Wrong owner"),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/calls/prep", {
        method: "POST",
        body: JSON.stringify({
          accountId: "foreign",
          founderObjective: "Prep",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
