/**
 * GET /api/agent-loops/readiness — per-repo allowlist precheck (#767)
 *
 * Written first (RED phase). Extends the readiness route to accept
 * owner/repo query params and report a real per-repo allowlist check via
 * isAgentLoopRepoAllowed, so the create form can precheck before submit.
 * The base response shape (enabled, checks[]) must stay backward-compatible
 * when owner/repo are omitted (covered by route.test.ts).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const isAgentLoopsEnabled = mock(() => true);
const getAgentLoopsAllowedRepos = mock(() => null as Set<string> | null);
const isAgentLoopRepoAllowed = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  getAgentLoopsAllowedRepos,
  isAgentLoopRepoAllowed,
}));

const routeModulePromise = import("./route");

describe("GET /api/agent-loops/readiness?owner=&repo= (#767)", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    getAgentLoopsAllowedRepos.mockImplementation(() => null);
    isAgentLoopRepoAllowed.mockImplementation(() => true);
  });

  test("omits the repo check when owner/repo are not provided (backward-compatible)", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/readiness"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const repoCheck = body.checks.find(
      (c: { id: string }) => c.id === "repo_access",
    );
    expect(repoCheck).toBeUndefined();
  });

  test("reports repo_access ready when the repo is allowed", async () => {
    isAgentLoopRepoAllowed.mockImplementation(() => true);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/agent-loops/readiness?owner=acme&repo=widgets",
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const repoCheck = body.checks.find(
      (c: { id: string }) => c.id === "repo_access",
    );
    expect(repoCheck).toBeDefined();
    expect(repoCheck.status).toBe("ready");
  });

  test("reports repo_access disabled when the repo is not allowlisted", async () => {
    isAgentLoopRepoAllowed.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost/api/agent-loops/readiness?owner=acme&repo=widgets",
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const repoCheck = body.checks.find(
      (c: { id: string }) => c.id === "repo_access",
    );
    expect(repoCheck).toBeDefined();
    expect(repoCheck.status).toBe("disabled");
  });
});
