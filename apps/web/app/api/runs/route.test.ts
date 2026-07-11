import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const listDbBackedAutomationRuns = mock(async () => ({
  requestId: "request-1",
  generatedAt: "2026-07-11T12:00:00.000Z",
  items: [],
  sourceStatus: [],
  allSourcesFailed: false,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));
mock.module("@/lib/runs/store", () => ({ listDbBackedAutomationRuns }));

const routePromise = import("./route");

describe("GET /api/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    listDbBackedAutomationRuns.mockClear();
  });

  test("does not probe sources before authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routePromise;
    const response = await GET(new Request("http://localhost/api/runs"));

    expect(response.status).toBe(401);
    expect(listDbBackedAutomationRuns).not.toHaveBeenCalled();
  });

  test("validates filters and forwards only the authenticated owner", async () => {
    const { GET } = await routePromise;
    const invalid = await GET(
      new Request("http://localhost/api/runs?repoOwner=acme"),
    );
    expect(invalid.status).toBe(400);
    expect(listDbBackedAutomationRuns).not.toHaveBeenCalled();

    const response = await GET(
      new Request(
        "http://localhost/api/runs?view=active&repoOwner=acme&repoName=shop&limit=25",
        { headers: { "x-request-id": "request-42" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(listDbBackedAutomationRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        requestId: "request-42",
        filters: { view: "active", repoOwner: "acme", repoName: "shop" },
        limit: 25,
      }),
    );
  });
});
