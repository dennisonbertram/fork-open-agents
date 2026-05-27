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
const readiness = {
  enabled: false,
  ready: false,
  missing: ["BACKGROUND_AGENTS_ENABLED"],
  checks: [
    {
      id: "feature_flag",
      label: "Feature flag",
      status: "disabled",
      detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
      missing: ["BACKGROUND_AGENTS_ENABLED"],
    },
  ],
};
const getBackgroundAgentReadiness = mock(() => readiness);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/readiness", () => ({
  getBackgroundAgentReadiness,
}));

const routeModulePromise = import("./route");

describe("GET /api/background-agents/readiness", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    getBackgroundAgentReadiness.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getBackgroundAgentReadiness).not.toHaveBeenCalled();
  });

  test("returns background agent readiness without secrets", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(readiness);
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(getBackgroundAgentReadiness).toHaveBeenCalledTimes(1);
  });
});
