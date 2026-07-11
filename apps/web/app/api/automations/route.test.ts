import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let authResult:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const listAutomations = mock(async () => ({
  automations: [],
  total: 0,
  sourceStatus: [],
  facets: { repositories: [], kinds: [], states: [] },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));
mock.module("@/lib/automations/store", () => ({ listAutomations }));

const routeModulePromise = import("./route");

describe("GET /api/automations", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    listAutomations.mockClear();
  });

  test("requires authentication without probing sources", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost/api/automations"));
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requestId).toMatch(/^[A-Za-z0-9._:/=-]{8,128}$/);
    expect(requestId?.length).toBeLessThanOrEqual(128);
    expect(listAutomations).not.toHaveBeenCalled();
  });

  test("rejects invalid filters without probing sources", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/automations?repository=missing-slash"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_filters");
    expect(listAutomations).not.toHaveBeenCalled();
  });

  test("passes owner-scoped validated filters and returns no-store correlation", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/automations?repository=Acme%2FWidgets&kind=single_step&state=enabled",
        { headers: { "x-request-id": "request-1234" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1234");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(listAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        filters: {
          repository: { owner: "Acme", name: "Widgets" },
          kind: "single_step",
          state: "enabled",
        },
      }),
    );
  });
});
