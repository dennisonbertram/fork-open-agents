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
import type { RepositoryAllowlistPolicy } from "@/lib/repository-allowlist";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const isAgentLoopsEnabled = mock(() => true);
const getAgentLoopsAllowedRepos = mock(() => null as Set<string> | null);
const getAgentLoopsRepoPolicy = mock<() => RepositoryAllowlistPolicy>(() => ({
  state: "wildcard",
  entries: new Set(),
}));
const getAgentLoopRepoAccess = mock<
  () =>
    | { allowed: true }
    | {
        allowed: false;
        reason:
          | "repo_allowlist_unconfigured"
          | "repo_allowlist_invalid"
          | "repo_not_allowed";
      }
>(() => ({ allowed: true }));
const isAgentLoopRepoAllowed = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  getAgentLoopsAllowedRepos,
  getAgentLoopsRepoPolicy,
  getAgentLoopRepoAccess,
  isAgentLoopRepoAllowed,
}));

const routeModulePromise = import("./route");

describe("GET /api/agent-loops/readiness?owner=&repo= (#767)", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    getAgentLoopsAllowedRepos.mockImplementation(() => null);
    getAgentLoopsRepoPolicy.mockImplementation(() => ({
      state: "wildcard" as const,
      entries: new Set<string>(),
    }));
    getAgentLoopRepoAccess.mockImplementation(() => ({ allowed: true }));
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
    getAgentLoopRepoAccess.mockImplementation(() => ({ allowed: true }));
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
    getAgentLoopRepoAccess.mockImplementation(() => ({
      allowed: false,
      reason: "repo_not_allowed",
    }));
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

  test("reports repo_access missing when the operator policy is absent", async () => {
    getAgentLoopsRepoPolicy.mockImplementation(() => ({
      state: "missing" as const,
      entries: new Set<string>(),
    }));
    getAgentLoopRepoAccess.mockImplementation(() => ({
      allowed: false,
      reason: "repo_allowlist_unconfigured",
    }));
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/agent-loops/readiness?owner=acme&repo=widgets",
      ),
    );
    const body = await response.json();
    const repoCheck = body.checks.find(
      (check: { id: string }) => check.id === "repo_access",
    );

    expect(repoCheck).toMatchObject({
      status: "missing",
      missing: ["AGENT_LOOPS_ALLOWED_REPOS"],
    });
  });
});
