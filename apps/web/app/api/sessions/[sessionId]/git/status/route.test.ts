import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
type OwnedResult =
  | { ok: true; sessionRecord: { id: string; userId: string } }
  | { ok: false; response: Response };

let authResult: AuthResult;
let ownedResult: OwnedResult;
const getGitStatusCalls: Array<Record<string, unknown>> = [];
let getGitStatusImpl: (params: Record<string, unknown>) => Promise<unknown>;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSession: async () => ownedResult,
}));

mock.module("@/lib/git/queries/status", () => ({
  getGitStatus: async (params: Record<string, unknown>) => {
    getGitStatusCalls.push(params);
    return getGitStatusImpl(params);
  },
}));

const { GET } = await import("./route");

function context(sessionId = "sess_1") {
  return { params: Promise.resolve({ sessionId }) };
}
const getRequest = () =>
  new Request("http://localhost/api/sessions/sess_1/git/status");

beforeEach(() => {
  authResult = { ok: true, userId: "u1" };
  ownedResult = { ok: true, sessionRecord: { id: "sess_1", userId: "u1" } };
  getGitStatusCalls.length = 0;
  getGitStatusImpl = async () => ({
    branch: "main",
    hasUncommittedChanges: false,
  });
});

describe("GET /api/sessions/[sessionId]/git/status", () => {
  test("401 when unauthenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const res = await GET(getRequest(), context());
    expect(res.status).toBe(401);
    expect(getGitStatusCalls).toHaveLength(0);
  });

  test("403 when the caller does not own the session", async () => {
    ownedResult = {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
    const res = await GET(getRequest(), context());
    expect(res.status).toBe(403);
    expect(getGitStatusCalls).toHaveLength(0);
  });

  test("404 when the session is missing", async () => {
    ownedResult = {
      ok: false,
      response: Response.json({ error: "Session not found" }, { status: 404 }),
    };
    const res = await GET(getRequest(), context());
    expect(res.status).toBe(404);
    expect(getGitStatusCalls).toHaveLength(0);
  });

  test("returns the status under a 'status' key for the owned session", async () => {
    const res = await GET(getRequest(), context("sess_9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: { branch: "main", hasUncommittedChanges: false },
    });
    expect(getGitStatusCalls[0]).toEqual({ sessionId: "sess_9" });
  });

  test("maps a thrown 'Sandbox not initialized' to 409", async () => {
    getGitStatusImpl = async () => {
      throw new Error("Sandbox not initialized");
    };
    const res = await GET(getRequest(), context());
    expect(res.status).toBe(409);
  });
});
