import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
type OwnedResult =
  | { ok: true; sessionRecord: { id: string; userId: string } }
  | { ok: false; response: Response };

let authResult: AuthResult;
let ownedResult: OwnedResult;
const createBranchCalls: Array<Record<string, unknown>> = [];
let createBranchImpl: (params: Record<string, unknown>) => Promise<unknown>;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSession: async () => ownedResult,
}));

mock.module("@/lib/git/actions/branch", () => ({
  createBranch: async (params: Record<string, unknown>) => {
    createBranchCalls.push(params);
    return createBranchImpl(params);
  },
}));

const { POST } = await import("./route");

function context(sessionId = "sess_1") {
  return { params: Promise.resolve({ sessionId }) };
}

function postRequest(body?: unknown) {
  return new Request("http://localhost/api/sessions/sess_1/git/branch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validBody = {
  sessionTitle: "My session",
  baseBranch: "main",
  branchName: "feature/x",
};

beforeEach(() => {
  authResult = { ok: true, userId: "u1" };
  ownedResult = { ok: true, sessionRecord: { id: "sess_1", userId: "u1" } };
  createBranchCalls.length = 0;
  createBranchImpl = async () => ({ branchName: "feature/x" });
});

describe("POST /api/sessions/[sessionId]/git/branch", () => {
  test("401 when unauthenticated; does not call the action", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const res = await POST(postRequest(validBody), context());
    expect(res.status).toBe(401);
    expect(createBranchCalls).toHaveLength(0);
  });

  test("403 when the caller does not own the session", async () => {
    ownedResult = {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
    const res = await POST(postRequest(validBody), context());
    expect(res.status).toBe(403);
    expect(createBranchCalls).toHaveLength(0);
  });

  test("400 on an invalid body", async () => {
    const res = await POST(postRequest({ sessionTitle: "s" }), context());
    expect(res.status).toBe(400);
    expect(createBranchCalls).toHaveLength(0);
  });

  test("delegates to createBranch with sessionId + body and returns the result", async () => {
    const res = await POST(postRequest(validBody), context("sess_42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: "feature/x" });
    expect(createBranchCalls[0]).toEqual({
      sessionId: "sess_42",
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "feature/x",
    });
  });

  test("maps a thrown 'Sandbox not initialized' to 409", async () => {
    createBranchImpl = async () => {
      throw new Error("Sandbox not initialized");
    };
    const res = await POST(postRequest(validBody), context());
    expect(res.status).toBe(409);
  });
});
