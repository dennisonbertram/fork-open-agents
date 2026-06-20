import { beforeEach, describe, expect, mock, test } from "bun:test";

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
const buildDbBackedAccountSnapshot = mock(
  async (input: { userId: string; window: string | null }) => ({
    generatedAt: "2026-06-20T12:00:00.000Z",
    window: {
      requested: input.window ?? "24h",
      hours: 24,
      since: "2026-06-19T12:00:00.000Z",
    },
    sourceStatus: [],
    needsAttention: [],
    running: [],
    recentlyCompleted: [],
    waitingOnUser: [],
    stale: [],
    scheduledAgents: [],
  }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/account-coordinator/store", () => ({
  buildDbBackedAccountSnapshot,
}));

const routeModulePromise = import("./route");

describe("GET /api/account/status", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    buildDbBackedAccountSnapshot.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/account/status?window=24h"),
    );

    expect(response.status).toBe(401);
    expect(buildDbBackedAccountSnapshot).not.toHaveBeenCalled();
  });

  test("returns the authenticated user's bounded account snapshot", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/account/status?window=24h"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.window.requested).toBe("24h");
    expect(buildDbBackedAccountSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
      window: "24h",
    });
  });
});
