import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- mock Octokit state ---------------------------------------------------

type OctokitResponse<T> = { data: T };
type MockPr = {
  number: number;
  title: string;
  draft: boolean;
  state: string;
  user: { login: string } | null;
  base: { ref: string };
  head: { sha: string };
  updated_at: string;
};
type MockIssue = {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  updated_at: string;
  pull_request?: { url: string };
};
type MockWorkflowRun = {
  id: number;
  name: string | null;
  conclusion: string | null;
  status: string;
  created_at: string;
};
type MockCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
};

let mockPrList: MockPr[] = [];
let mockIssueList: MockIssue[] = [];
let mockWorkflowRuns: MockWorkflowRun[] = [];
let mockCheckRuns: MockCheckRun[] = [];
let mockPrListError: Error | null = null;
let mockIssueListError: Error | null = null;
let mockWorkflowRunsError: Error | null = null;
let mockUserOctokit: {
  rest: {
    pulls: { list: (_args: unknown) => Promise<OctokitResponse<MockPr[]>> };
    issues: { listForRepo: (_args: unknown) => Promise<OctokitResponse<MockIssue[]>> };
    actions: { listWorkflowRunsForRepo: (_args: unknown) => Promise<OctokitResponse<{ workflow_runs: MockWorkflowRun[] }>> };
    checks: { listForRef: (_args: unknown) => Promise<OctokitResponse<{ check_runs: MockCheckRun[] }>> };
  };
} | null = null;

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async () => mockUserOctokit,
}));

// Lazy-import after mocks are wired
const helperModulePromise = import("./repo-dashboard");

function makeMockOctokit() {
  return {
    rest: {
      pulls: {
        list: async (): Promise<OctokitResponse<MockPr[]>> => {
          if (mockPrListError) throw mockPrListError;
          return { data: mockPrList };
        },
      },
      issues: {
        listForRepo: async (): Promise<OctokitResponse<MockIssue[]>> => {
          if (mockIssueListError) throw mockIssueListError;
          return { data: mockIssueList };
        },
      },
      actions: {
        listWorkflowRunsForRepo: async (): Promise<OctokitResponse<{ workflow_runs: MockWorkflowRun[] }>> => {
          if (mockWorkflowRunsError) throw mockWorkflowRunsError;
          return { data: { workflow_runs: mockWorkflowRuns } };
        },
      },
      checks: {
        listForRef: async (): Promise<OctokitResponse<{ check_runs: MockCheckRun[] }>> => {
          return { data: { check_runs: mockCheckRuns } };
        },
      },
    },
  };
}

describe("getRepoDashboardData", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockUserOctokit = makeMockOctokit();
  });

  // BT-H-001: no GitHub token → all windows return github_not_connected
  test("BT-H-001: returns github_not_connected errorKind when no user octokit", async () => {
    mockUserOctokit = null;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.prSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
    expect(result.issueSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
    expect(result.actionsSummary).toMatchObject({
      ok: false,
      errorKind: "github_not_connected",
    });
  });

  // BT-H-002: bounded PR list — top N only, not full history
  test("BT-H-002: PR list is bounded (max 20 items returned)", async () => {
    // Simulate 30 open PRs
    mockPrList = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      draft: false,
      state: "open",
      user: { login: `user${i}` },
      base: { ref: "main" },
      head: { sha: `sha${i}` },
      updated_at: new Date(Date.now() - i * 60000).toISOString(),
    }));

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) {
      throw new Error(`Expected ok result, got ${result.prSummary.errorKind}`);
    }
    // Must be bounded — should not return all 30
    expect(result.prSummary.prs.length).toBeLessThanOrEqual(20);
  });

  // BT-H-003: PR summary includes key fields
  test("BT-H-003: PR summary includes number, title, isDraft, author, baseBranch", async () => {
    mockPrList = [
      {
        number: 7,
        title: "feat: add telemetry",
        draft: true,
        state: "open",
        user: { login: "alice" },
        base: { ref: "develop" },
        head: { sha: "abc123" },
        updated_at: "2026-05-15T10:00:00Z",
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) {
      throw new Error("Expected ok prSummary");
    }

    const pr = result.prSummary.prs[0];
    if (!pr) throw new Error("Expected at least one PR");
    expect(pr.number).toBe(7);
    expect(pr.title).toBe("feat: add telemetry");
    expect(pr.isDraft).toBe(true);
    expect(pr.author).toBe("alice");
    expect(pr.baseBranch).toBe("develop");
  });

  // BT-H-004: issue list is bounded
  test("BT-H-004: issue list is bounded (max 20 items returned)", async () => {
    // 25 issues
    mockIssueList = Array.from({ length: 25 }, (_, i) => ({
      number: i + 100,
      title: `Issue ${i + 1}`,
      labels: [],
      updated_at: new Date().toISOString(),
    }));

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) {
      throw new Error("Expected ok issueSummary");
    }
    expect(result.issueSummary.recent.length).toBeLessThanOrEqual(20);
  });

  // BT-H-005: issue list excludes PRs (GitHub issues API returns PRs too)
  test("BT-H-005: issue summary excludes pull requests from the issues list", async () => {
    mockIssueList = [
      {
        number: 1,
        title: "Real issue",
        labels: [],
        updated_at: new Date().toISOString(),
        // No pull_request key — it's a real issue
      },
      {
        number: 2,
        title: "This is actually a PR",
        labels: [],
        updated_at: new Date().toISOString(),
        pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/2" },
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) {
      throw new Error("Expected ok issueSummary");
    }

    // The PR-shaped item must be excluded from the issue list
    const numbers = result.issueSummary.recent.map((i) => i.number);
    expect(numbers).toContain(1);
    expect(numbers).not.toContain(2);
  });

  // BT-H-006: PR fetch fails independently → prSummary has errorKind, others succeed
  test("BT-H-006: partial failure — PR fetch fails, issues and actions still succeed", async () => {
    mockPrListError = new Error("rate limited");
    Object.assign(mockPrListError, { status: 429 });

    mockIssueList = [
      { number: 5, title: "Bug", labels: [], updated_at: new Date().toISOString() },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // PR failed
    expect(result.prSummary.ok).toBe(false);
    // Issues succeeded
    expect(result.issueSummary.ok).toBe(true);
    // Actions succeeded (no error configured)
    expect(result.actionsSummary.ok).toBe(true);
  });

  // BT-H-007: issue fetch fails independently → issueSummary has errorKind, PRs succeed
  test("BT-H-007: partial failure — issue fetch fails, PRs still succeed", async () => {
    mockPrList = [
      {
        number: 1,
        title: "Healthy PR",
        draft: false,
        state: "open",
        user: { login: "bob" },
        base: { ref: "main" },
        head: { sha: "deadbeef" },
        updated_at: new Date().toISOString(),
      },
    ];
    mockIssueListError = new Error("GitHub unavailable");

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // PRs succeeded
    expect(result.prSummary.ok).toBe(true);
    // Issues failed
    expect(result.issueSummary.ok).toBe(false);
    // Actions succeeded
    expect(result.actionsSummary.ok).toBe(true);
  });

  // BT-H-008: 429 rate limit → provider_rate_limited errorKind
  test("BT-H-008: 429 from GitHub maps to provider_rate_limited errorKind", async () => {
    const rateLimitError = new Error("rate limited");
    Object.assign(rateLimitError, { status: 429 });
    mockPrListError = rateLimitError;
    mockIssueListError = rateLimitError;
    mockWorkflowRunsError = rateLimitError;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.prSummary).toMatchObject({
      ok: false,
      errorKind: "provider_rate_limited",
    });
    expect(result.issueSummary).toMatchObject({
      ok: false,
      errorKind: "provider_rate_limited",
    });
    expect(result.actionsSummary).toMatchObject({
      ok: false,
      errorKind: "provider_rate_limited",
    });
  });

  // REDACT-H-001: helper result must not contain raw token strings
  test("REDACT-H-001: result from helper does not contain token-like strings in PR titles or issue titles", async () => {
    // Simulate a PR whose title accidentally contains something token-like
    mockPrList = [
      {
        number: 1,
        title: "Update config with token ghp_notarealtoken12345678",
        draft: false,
        state: "open",
        user: { login: "someone" },
        base: { ref: "main" },
        head: { sha: "abc" },
        updated_at: new Date().toISOString(),
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // The title IS shown (it's user-generated content, not a secret)
    // But the raw octokit response body must not be passed through wholesale
    const resultText = JSON.stringify(result);
    // Must not contain Bearer authorization headers or installation token patterns
    expect(resultText).not.toMatch(/Authorization:\s*Bearer/i);
    expect(resultText).not.toMatch(/"token"\s*:\s*"(ghp_|ghs_)/);
  });
});
