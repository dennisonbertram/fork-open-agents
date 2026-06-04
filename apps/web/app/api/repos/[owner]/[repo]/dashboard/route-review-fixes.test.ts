/**
 * Failing tests for #162 review blockers:
 * - BLOCKER 1: Partial-failure isolation (route.ts Promise.all must not kill full response)
 * - BLOCKER 2: App-access state (repoReadiness drives GitHub window error kind)
 *
 * These tests MUST fail before the fix is applied.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

type MockPrSummary =
  | { ok: true; prs: Array<{ number: number; title: string; isDraft: boolean }> }
  | { ok: false; errorKind: string };

type MockIssueSummary =
  | { ok: true; totalOpen: number; recent: Array<{ number: number; title: string }> }
  | { ok: false; errorKind: string };

type MockActionsSummary =
  | { ok: true; latestStatus: string; recentRuns: unknown[] }
  | { ok: false; errorKind: string };

let mockPrSummary: MockPrSummary = { ok: true, prs: [] };
let mockIssueSummary: MockIssueSummary = { ok: true, totalOpen: 0, recent: [] };
let mockActionsSummary: MockActionsSummary = {
  ok: true,
  latestStatus: "passing",
  recentRuns: [],
};
let mockAgents: Array<{ id: string; name: string }> = [];
let mockRuns: Array<{ id: string; triggerKind: string }> = [];
let mockReadiness = { ready: true, checks: [], missing: [] };

// Injectable errors for local data sources (BLOCKER 1)
let agentsError: Error | null = null;
let runsError: Error | null = null;
let repoReadinessError: Error | null = null;

// Injectable repoReadiness result (BLOCKER 2)
type MockRepoReadiness = {
  ready: boolean;
  repoOwner: string;
  repoName: string;
  requiredUserPermission: string;
  reason: string | null;
  message: string;
  installationId: number | null;
  repositoryId: number | null;
  defaultBranch: string | null;
};

let mockRepoReadiness: MockRepoReadiness = {
  ready: true,
  repoOwner: "acme",
  repoName: "widgets",
  requiredUserPermission: "read",
  reason: null,
  message: "Access granted",
  installationId: 42,
  repositoryId: 999,
  defaultBranch: "main",
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async () => ({
    prSummary: mockPrSummary,
    issueSummary: mockIssueSummary,
    actionsSummary: mockActionsSummary,
  }),
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents: async () => {
    if (agentsError) throw agentsError;
    return mockAgents;
  },
  listBackgroundAgentRuns: async () => {
    if (runsError) throw runsError;
    return mockRuns;
  },
}));

mock.module("@/lib/background-agents/readiness", () => ({
  getBackgroundAgentReadinessWithGitHubAppMetadata: async () => mockReadiness,
}));

mock.module("@/lib/background-agents/repo-readiness", () => ({
  getBackgroundAgentRepoReadiness: async () => {
    if (repoReadinessError) throw repoReadinessError;
    return mockRepoReadiness;
  },
}));

const routeModulePromise = import("./route");

describe("Route review-fix: partial-failure isolation (BLOCKER 1)", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    mockPrSummary = { ok: true, prs: [] };
    mockIssueSummary = { ok: true, totalOpen: 0, recent: [] };
    mockActionsSummary = { ok: true, latestStatus: "passing", recentRuns: [] };
    mockAgents = [{ id: "agent-1", name: "Deploy smoke" }];
    mockRuns = [];
    mockReadiness = { ready: true, checks: [], missing: [] };
    mockRepoReadiness = {
      ready: true,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
      reason: null,
      message: "Access granted",
      installationId: 42,
      repositoryId: 999,
      defaultBranch: "main",
    };
    agentsError = null;
    runsError = null;
    repoReadinessError = null;
  });

  // BLOCKER1-A: listRepoBackgroundAgents rejects → route must still 200,
  // GitHub windows must render, agents window shows safe empty/error state.
  test("BLOCKER1-A: when listRepoBackgroundAgents rejects, route returns 200 and GitHub windows render", async () => {
    agentsError = new Error("DB connection refused");
    mockPrSummary = {
      ok: true,
      prs: [{ number: 5, title: "feat: add widget", isDraft: false }],
    };
    mockIssueSummary = { ok: true, totalOpen: 3, recent: [] };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    // Must NOT return 500 because agents failed
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prSummary: MockPrSummary;
      issueSummary: MockIssueSummary;
      agents: unknown;
    };

    // GitHub windows still present and ok
    expect(body.prSummary).toMatchObject({ ok: true });
    const prOk = body.prSummary as { ok: true; prs: Array<{ number: number }> };
    expect(prOk.prs[0]?.number).toBe(5);
    expect(body.issueSummary).toMatchObject({ ok: true });
    // body must still be a valid JSON object (not an error page)
    expect(body).toBeDefined();
  });

  // BLOCKER1-B: getBackgroundAgentRepoReadiness rejects → route must still 200.
  test("BLOCKER1-B: when getBackgroundAgentRepoReadiness rejects, route returns 200", async () => {
    repoReadinessError = new Error("GitHub API timeout");
    mockPrSummary = {
      ok: true,
      prs: [{ number: 9, title: "fix: bug", isDraft: false }],
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    // Must NOT 500 because repoReadiness failed
    expect(response.status).toBe(200);
    const body = (await response.json()) as { prSummary: MockPrSummary };
    // GitHub windows should still be present
    expect(body.prSummary).toMatchObject({ ok: true });
  });

  // BLOCKER1-C: listBackgroundAgentRuns rejects → route must still 200
  test("BLOCKER1-C: when listBackgroundAgentRuns rejects, route returns 200", async () => {
    runsError = new Error("runs DB offline");
    mockAgents = [{ id: "agent-1", name: "CI watcher" }];

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { agents: unknown[] };
    // agents still returned (they didn't fail)
    expect(body.agents).toHaveLength(1);
  });
});

describe("Route review-fix: App-access classification drives GitHub windows (BLOCKER 2)", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    mockPrSummary = { ok: true, prs: [] };
    mockIssueSummary = { ok: true, totalOpen: 0, recent: [] };
    mockActionsSummary = { ok: true, latestStatus: "passing", recentRuns: [] };
    mockAgents = [];
    mockRuns = [];
    mockReadiness = { ready: true, checks: [], missing: [] };
    mockRepoReadiness = {
      ready: true,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
      reason: null,
      message: "Access granted",
      installationId: 42,
      repositoryId: 999,
      defaultBranch: "main",
    };
    agentsError = null;
    runsError = null;
    repoReadinessError = null;
  });

  // BLOCKER2-A: When repoReadiness.reason is no_installation,
  // the route loader must override GitHub window errorKind to installation_missing
  // and NOT return OAuth-token data as if current.
  test("BLOCKER2-A: when repoReadiness.reason is no_installation, GitHub windows show installation_missing errorKind", async () => {
    mockRepoReadiness = {
      ready: false,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
      reason: "no_installation",
      message: "No installation found",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
    };

    // The helper would return OK PR data via user OAuth — but the loader should
    // short-circuit it because the App is not installed
    mockPrSummary = {
      ok: true,
      prs: [{ number: 99, title: "This should be hidden", isDraft: false }],
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prSummary: MockPrSummary;
      issueSummary: MockIssueSummary;
      actionsSummary: MockActionsSummary;
    };

    // GitHub windows must show installation_missing, NOT the OAuth PR data
    expect(body.prSummary).toMatchObject({
      ok: false,
      errorKind: "installation_missing",
    });
    expect(body.issueSummary).toMatchObject({
      ok: false,
      errorKind: "installation_missing",
    });
    expect(body.actionsSummary).toMatchObject({
      ok: false,
      errorKind: "installation_missing",
    });
  });

  // BLOCKER2-B: When repoReadiness.reason is app_no_access,
  // the route loader must override GitHub window errorKind to app_no_access.
  test("BLOCKER2-B: when repoReadiness.reason is app_no_access, GitHub windows show app_no_access errorKind", async () => {
    mockRepoReadiness = {
      ready: false,
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "read",
      reason: "app_no_access",
      message: "App has no access to this repo",
      installationId: 10,
      repositoryId: null,
      defaultBranch: null,
    };

    // Even if OAuth user token PRs succeeded, the loader should short-circuit
    mockPrSummary = {
      ok: true,
      prs: [{ number: 77, title: "Stale OAuth data", isDraft: false }],
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prSummary: MockPrSummary;
    };

    expect(body.prSummary).toMatchObject({
      ok: false,
      errorKind: "app_no_access",
    });
  });
});
