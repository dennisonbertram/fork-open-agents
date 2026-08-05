import { describe, expect, mock, test } from "bun:test";

// Issue #1057: a freshly created session has no sandbox yet. That is a normal
// lifecycle state, not a malformed request, so the route must answer 409 with a
// typed errorKind instead of 400.
mock.module("server-only", () => ({}));
mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
}));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));
mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => ({
    id: "session-1",
    userId: "user-1",
    sandboxState: null,
  }),
  getChatById: async () => null,
  getChatsBySessionId: async () => [],
  updateSession: async () => undefined,
}));

function createContext() {
  return { params: Promise.resolve({ sessionId: "session-1" }) };
}

describe("GET /api/sessions/[sessionId]/diff without a sandbox", () => {
  test("reports 409 sandbox_not_initialized, not 400", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/diff") as never,
      createContext(),
    );
    const body = (await response.json()) as {
      error?: string;
      errorKind?: string;
    };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Sandbox not initialized");
    expect(body.errorKind).toBe("sandbox_not_initialized");
  });
});
