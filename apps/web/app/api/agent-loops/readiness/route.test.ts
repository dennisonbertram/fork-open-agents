/**
 * Tests for GET /api/agent-loops/readiness
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const isAgentLoopsEnabled = mock(() => false);
const getAgentLoopsAllowedRepos = mock(() => null);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  getAgentLoopsAllowedRepos,
}));

const routeModulePromise = import("./route");

describe("GET /api/agent-loops/readiness", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => false);
    getAgentLoopsAllowedRepos.mockImplementation(() => null);
  });

  test("BT-033: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const response = await GET();
    expect(response.status).toBe(401);
  });

  test("BT-034: returns readiness shape with enabled flag and checks array", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      enabled: expect.any(Boolean),
      checks: expect.any(Array),
    });
  });

  test("BT-035: reports feature_flag check as disabled when AGENT_LOOPS_ENABLED is unset", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    const flagCheck = body.checks.find(
      (c: { id: string }) => c.id === "feature_flag",
    );
    expect(flagCheck).toBeDefined();
    expect(flagCheck.status).toBe("disabled");
    expect(flagCheck.missing).toContain("AGENT_LOOPS_ENABLED");
  });

  test("BT-036: reports enabled:true when flag is on", async () => {
    isAgentLoopsEnabled.mockImplementation(() => true);
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    const flagCheck = body.checks.find(
      (c: { id: string }) => c.id === "feature_flag",
    );
    expect(flagCheck?.status).toBe("ready");
  });

  test("BT-037: never returns secret values in response body", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = await response.text();
    // No secret values should appear
    expect(body).not.toContain("secret-value");
    expect(body).not.toContain("password");
  });

  test("BT-038: reports allowlist check with wildcard when unrestricted", async () => {
    isAgentLoopsEnabled.mockImplementation(() => true);
    getAgentLoopsAllowedRepos.mockImplementation(() => null); // null = wildcard/unrestricted
    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    const allowlistCheck = body.checks.find(
      (c: { id: string }) => c.id === "repo_allowlist",
    );
    expect(allowlistCheck).toBeDefined();
    // wildcard means unrestricted = ready
    expect(allowlistCheck.status).toBe("ready");
  });
});
