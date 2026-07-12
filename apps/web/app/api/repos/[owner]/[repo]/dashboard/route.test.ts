import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- mutable auth state ---------------------------------------------------

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

// ---- mutable dashboard data state ----------------------------------------

type MockPrSummary =
  | {
      ok: true;
      prs: Array<{ number: number; title: string; isDraft: boolean }>;
    }
  | { ok: false; errorKind: string };

type MockIssueSummary =
  | {
      ok: true;
      totalOpen: number;
      recent: Array<{ number: number; title: string }>;
    }
  | { ok: false; errorKind: string };

type MockActionsSummary =
  | {
      ok: true;
      latestStatus: "passing" | "failing" | "pending";
      recentRuns: Array<{ name: string; conclusion: string | null }>;
    }
  | { ok: false; errorKind: string };

let mockPrSummary: MockPrSummary = {
  ok: true,
  prs: [],
};
let mockIssueSummary: MockIssueSummary = {
  ok: true,
  totalOpen: 0,
  recent: [],
};
let mockActionsSummary: MockActionsSummary = {
  ok: true,
  latestStatus: "passing",
  recentRuns: [],
};

let mockAgents: Array<{ id: string; name: string }> = [];
let mockRuns: Array<Record<string, unknown> & { id: string }> = [];
let mockReadiness = { ready: true, checks: [], missing: [] };

// ---- mocks ----------------------------------------------------------------

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/github/repo-dashboard", () => ({
  getRepoDashboardData: async (_params: {
    userId: string;
    owner: string;
    repo: string;
  }) => ({
    prSummary: mockPrSummary,
    issueSummary: mockIssueSummary,
    actionsSummary: mockActionsSummary,
  }),
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents: async () => mockAgents,
  listBackgroundAgentRuns: async () => mockRuns,
}));

mock.module("@/lib/background-agents/readiness", () => ({
  getBackgroundAgentReadinessWithGitHubAppMetadata: async () => mockReadiness,
}));

mock.module("@/lib/background-agents/repo-readiness", () => ({
  getBackgroundAgentRepoReadiness: async () => ({
    ready: true,
    repoOwner: "acme",
    repoName: "widgets",
    requiredUserPermission: "read",
    reason: null,
    message: "Access granted",
    installationId: 42,
    repositoryId: 999,
    defaultBranch: "main",
  }),
}));

// Lazy-import route after mocks are wired
const routeModulePromise = import("./route");

describe("GET /api/repos/[owner]/[repo]/dashboard", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    mockPrSummary = { ok: true, prs: [] };
    mockIssueSummary = { ok: true, totalOpen: 0, recent: [] };
    mockActionsSummary = { ok: true, latestStatus: "passing", recentRuns: [] };
    mockAgents = [];
    mockRuns = [];
    mockReadiness = { ready: true, checks: [], missing: [] };
  });

  // BT-001: unauthenticated → 401
  test("BT-001: returns 401 when user is not authenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    expect(response.status).toBe(401);
  });

  // BT-002: GitHub not connected → windows show github_not_connected error, local windows still render
  test("BT-002: when GitHub not connected, GitHub windows return github_not_connected errorKind", async () => {
    mockPrSummary = { ok: false, errorKind: "github_not_connected" };
    mockIssueSummary = { ok: false, errorKind: "github_not_connected" };
    mockActionsSummary = { ok: false, errorKind: "github_not_connected" };
    mockAgents = [{ id: "agent-1", name: "Deploy smoke" }];

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
      agents: Array<{ id: string }>;
    };

    expect(body.prSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
    expect(body.issueSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
    expect(body.actionsSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
    // Local agent data still returned
    expect(body.agents).toHaveLength(1);
  });

  // BT-003: successful aggregate with full data shape
  test("BT-003: returns 200 with full aggregate shape when all data sources succeed", async () => {
    mockPrSummary = {
      ok: true,
      prs: [
        {
          number: 42,
          title: "feat: add widget",
          isDraft: false,
        },
      ],
    };
    mockIssueSummary = {
      ok: true,
      totalOpen: 5,
      recent: [{ number: 1, title: "Bug in widget" }],
    };
    mockActionsSummary = {
      ok: true,
      latestStatus: "passing",
      recentRuns: [{ name: "CI", conclusion: "success" }],
    };
    mockAgents = [{ id: "agent-1", name: "Deploy smoke" }];
    mockRuns = [{ id: "run-1", triggerKind: "github.push" }];

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
      agents: unknown[];
      runs: unknown[];
      readiness: { ready: boolean };
      repoReadiness: { ready: boolean };
    };

    // All keys present
    expect(body).toHaveProperty("prSummary");
    expect(body).toHaveProperty("issueSummary");
    expect(body).toHaveProperty("actionsSummary");
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("runs");
    expect(body).toHaveProperty("readiness");
    expect(body).toHaveProperty("repoReadiness");

    // PR summary content
    expect(body.prSummary).toMatchObject({ ok: true });
    const prOk = body.prSummary as { ok: true; prs: Array<{ number: number }> };
    expect(prOk.prs[0]?.number).toBe(42);

    // Issue summary content
    const issueOk = body.issueSummary as { ok: true; totalOpen: number };
    expect(issueOk.totalOpen).toBe(5);

    // Actions content
    const actionsOk = body.actionsSummary as { ok: true; latestStatus: string };
    expect(actionsOk.latestStatus).toBe("passing");

    // Local data
    expect(body.agents).toHaveLength(1);
    expect(body.runs).toHaveLength(1);
  });

  // BT-004: partial GitHub failure — one window fails, others succeed, 200 returned
  test("BT-004: partial GitHub failure — 200 returned, failed window has errorKind, other windows still ok", async () => {
    // PR fails, issues and actions succeed
    mockPrSummary = { ok: false, errorKind: "provider_unavailable" };
    mockIssueSummary = {
      ok: true,
      totalOpen: 3,
      recent: [{ number: 7, title: "Critical bug" }],
    };
    mockActionsSummary = {
      ok: true,
      latestStatus: "failing",
      recentRuns: [{ name: "build", conclusion: "failure" }],
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

    expect(body.prSummary).toMatchObject({
      ok: false,
      errorKind: "provider_unavailable",
    });
    expect(body.issueSummary).toMatchObject({ ok: true, totalOpen: 3 });
    expect(body.actionsSummary).toMatchObject({
      ok: true,
      latestStatus: "failing",
    });
  });

  // BT-005: missing GitHub App installation — shows setup state, no crash
  test("BT-005: app_no_access errorKind is preserved and response is still 200", async () => {
    mockPrSummary = { ok: false, errorKind: "app_no_access" };
    mockIssueSummary = { ok: false, errorKind: "app_no_access" };
    mockActionsSummary = { ok: false, errorKind: "app_no_access" };

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      prSummary: { ok: false; errorKind: string };
    };
    expect(body.prSummary.errorKind).toBe("app_no_access");
  });

  // REDACT-ROUTE-001: response body must not contain raw tokens, authorization strings
  test("REDACT-ROUTE-001: response body does not contain token-like strings", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );

    const bodyText = await response.text();
    // Must not contain Bearer tokens, ghp_ tokens, or authorization headers
    expect(bodyText).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{10,}/);
    expect(bodyText).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(bodyText).not.toMatch(/ghs_[A-Za-z0-9]{20,}/);
    expect(bodyText).not.toMatch(/"authorization"\s*:/i);
  });

  test("never exposes private execution snapshots through dashboard runs", async () => {
    mockRuns = [
      {
        id: "run-secret",
        executionSnapshot: {
          snapshotVersion: 1,
          instructions: "instructions-canary-secret",
        },
        definitionVersion: 1,
        definitionHash: "c".repeat(64),
      },
    ];
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/repos/acme/widgets/dashboard"),
      { params: Promise.resolve({ owner: "acme", repo: "widgets" }) },
    );
    const bodyText = await response.text();

    expect(bodyText).not.toContain("executionSnapshot");
    expect(bodyText).not.toContain("instructions-canary-secret");
    expect(bodyText).toContain('"definitionVersion":1');
  });
});
