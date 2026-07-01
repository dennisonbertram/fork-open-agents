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
const buildDbBackedGtmSnapshot = mock(
  async (input: { userId: string; window: string | null }) => ({
    generatedAt: "2026-06-30T12:00:00.000Z",
    window: {
      requested: input.window ?? "24h",
      hours: 24,
      since: "2026-06-29T12:00:00.000Z",
    },
    sourceStatus: [],
    needsAttention: [],
    running: [],
    recentlyCompleted: [],
    waiting: [],
    stale: [],
    nextActions: [],
  }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-coordinator/store", () => ({
  buildDbBackedGtmSnapshot,
}));

const routeModulePromise = import("./route");

describe("GET /api/gtm/brief", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    buildDbBackedGtmSnapshot.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/gtm/brief?window=24h"),
    );

    expect(response.status).toBe(401);
    expect(buildDbBackedGtmSnapshot).not.toHaveBeenCalled();
  });

  test("returns the authenticated user's bounded GTM brief", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/gtm/brief?window=24h"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.window.requested).toBe("24h");
    expect(buildDbBackedGtmSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
      window: "24h",
    });
  });

  test("rejects invalid window values before loading data", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/gtm/brief?window=tomorrow"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Invalid window",
      errorKind: "invalid_window",
      supportedFormat: "1h through 168h",
    });
    expect(buildDbBackedGtmSnapshot).not.toHaveBeenCalled();
  });
});
