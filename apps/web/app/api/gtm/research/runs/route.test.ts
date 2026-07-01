import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmResearchError } from "@/lib/gtm-research/types";

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
const createGtmResearchRun = mock(async () => ({
  runId: "run-1",
  brief: {
    citedFacts: [],
    unknownClaims: [],
    openQuestions: [],
    nextSteps: [],
    signalCandidates: [],
  },
  signalIds: [],
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-research/store", () => ({
  createGtmResearchRun,
}));

const routeModulePromise = import("./route");

describe("POST /api/gtm/research/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createGtmResearchRun.mockClear();
    createGtmResearchRun.mockResolvedValue({
      runId: "run-1",
      brief: {
        citedFacts: [],
        unknownClaims: [],
        openQuestions: [],
        nextSteps: [],
        signalCandidates: [],
      },
      signalIds: [],
    });
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/research/runs", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(createGtmResearchRun).not.toHaveBeenCalled();
  });

  test("starts a user-scoped research run with explicit request id", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/research/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-1",
        },
        body: JSON.stringify({
          accountId: "account-1",
          accountName: "Acme",
          claims: [
            {
              text: "Acme has a pain around approval-safe agents",
              evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
            },
          ],
          openQuestions: ["Who owns rollout?"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.runId).toBe("run-1");
    expect(createGtmResearchRun).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "req-1",
      accountId: "account-1",
      contactId: null,
      accountName: "Acme",
      contactName: null,
      claims: [
        {
          text: "Acme has a pain around approval-safe agents",
          evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
        },
      ],
      openQuestions: ["Who owns rollout?"],
      nextSteps: [],
    });
  });

  test("returns typed errors without creating external mutations", async () => {
    createGtmResearchRun.mockRejectedValue(
      new GtmResearchError(
        "cross_user_reference",
        "Research account does not belong to the requesting user.",
      ),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/research/runs", {
        method: "POST",
        body: JSON.stringify({ accountId: "foreign-account", claims: [] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errorKind).toBe("cross_user_reference");
  });
});
