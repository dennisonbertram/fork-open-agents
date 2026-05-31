/**
 * MEDIUM-9: Raw token POST response must set Cache-Control: private, no-store
 * to prevent the one-time token from being cached by proxies or CDNs.
 */
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const requireAuthenticatedUser = mock(async () => authResult);
const createApiToken = mock(async () => ({
  token: {
    id: "token-1",
    name: "CI Token",
    start: "oa_abcdef",
    last4: "wxyz",
    scopes: ["agent_runs:create"],
  },
  rawToken: "oa_secret_one_time",
}));
const listApiTokensForUser = mock(async () => []);
const revokeApiToken = mock(async () => ({
  id: "token-1",
  name: "CI Token",
  revokedAt: new Date().toISOString(),
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser,
}));
mock.module("@/lib/api-auth/tokens", () => ({
  createApiToken,
  listApiTokensForUser,
  revokeApiToken,
}));

const routeModulePromise = import("./route");

afterAll(() => {
  mock.restore();
});

describe("MEDIUM-9: POST /api/settings/api-tokens cache headers", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createApiToken.mockClear();
  });

  test("BT-009: POST response includes Cache-Control: private, no-store", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "CI Token" }),
      }),
    );

    // Before fix: no cache-control header set
    // After fix: Cache-Control: private, no-store
    const cacheControl = response.headers.get("cache-control");
    expect(cacheControl).not.toBeNull();
    expect(cacheControl?.toLowerCase()).toContain("no-store");
    expect(cacheControl?.toLowerCase()).toContain("private");
  });

  test("BT-009b: POST response includes Pragma: no-cache", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "CI Token" }),
      }),
    );

    const pragma = response.headers.get("pragma");
    expect(pragma).not.toBeNull();
    expect(pragma?.toLowerCase()).toContain("no-cache");
  });

  test("BT-009c: GET /api/settings/api-tokens does NOT expose rawToken", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(body.tokens).toBeDefined();
    // rawToken must never appear in GET response
    const hasRawToken = JSON.stringify(body).includes("oa_secret");
    expect(hasRawToken).toBe(false);
  });
});
