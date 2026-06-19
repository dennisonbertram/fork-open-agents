import { describe, expect, test } from "bun:test";
import { apiFetch, contractEnabled } from "./_client";

/**
 * Every protected endpoint must reject unauthenticated requests with 401.
 * This is the cheapest, highest-value contract: it proves the routes are
 * deployed AND that the auth gate is wired before any handler logic.
 */
const PROTECTED_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: "GET", path: "/api/settings/preferences" },
  { method: "GET", path: "/api/settings/skills" },
  { method: "GET", path: "/api/settings/model-variants" },
  { method: "GET", path: "/api/inference-profiles" },
  { method: "GET", path: "/api/sessions" },
  { method: "GET", path: "/api/usage" },
  { method: "POST", path: "/api/settings/skills" },
  { method: "GET", path: "/api/sessions/contract-smoke/git/status" },
  { method: "POST", path: "/api/sessions/contract-smoke/git/branch" },
  { method: "GET", path: "/api/sessions/contract-smoke/git/pr/readiness" },
];

describe.skipIf(!contractEnabled)("contract / auth gating", () => {
  test("contract suite is enabled (CONTRACT_BASE_URL set)", () => {
    expect(contractEnabled).toBe(true);
  });

  for (const endpoint of PROTECTED_ENDPOINTS) {
    test(`${endpoint.method} ${endpoint.path} returns 401 without auth`, async () => {
      const res = await apiFetch(endpoint.path, {
        method: endpoint.method,
        auth: false,
        body: endpoint.method === "POST" ? {} : undefined,
      });
      expect(res.status).toBe(401);
    });
  }
});
