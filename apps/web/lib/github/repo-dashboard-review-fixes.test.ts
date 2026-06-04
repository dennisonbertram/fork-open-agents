/**
 * Failing tests for #162 review blockers in repo-dashboard.ts:
 * - BLOCKER 3: totalOpen is wrong for repos with >20 open issues
 * - BLOCKER 4: checksStatus always "unknown"; PR check rollup not implemented
 * - MEDIUM: classifyGitHubError maps 403→repo_access_denied before checking rate-limit
 * - LOW: errorMessage() has no invalid_repo case
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type OctokitResponse<T> = { data: T };
type MockPr = {
  number: number;
  title: string;
  draft: boolean;
  state: string;
  user: { login: string } | null;
  base: { ref: string };
  head: { sha: string };
  html_url: string;
  updated_at: string;
};
type MockIssue = {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  updated_at: string;
  html_url: string;
  pull_request?: { url: string };
};
type MockWorkflowRun = {
  id: number;
  name: string | null;
  conclusion: string | null;
  status: string;
  created_at: string;
  html_url: string;
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

// For BLOCKER 3: a separate "search" or "count" call for true open-issue count
// We'll simulate the GraphQL/search API returning a higher totalCount
let mockIssueSearchTotalCount: number | null = null;
let mockIssueSearchError: Error | null = null;

let mockUserOctokit: {
  rest: {
    pulls: {
      list: (_args: unknown) => Promise<OctokitResponse<MockPr[]>>;
    };
    issues: {
      listForRepo: (_args: unknown) => Promise<OctokitResponse<MockIssue[]>>;
    };
    actions: {
      listWorkflowRunsForRepo: (
        _args: unknown,
      ) => Promise<OctokitResponse<{ workflow_runs: MockWorkflowRun[] }>>;
    };
    checks: {
      listForRef: (
        _args: unknown,
      ) => Promise<OctokitResponse<{ check_runs: MockCheckRun[] }>>;
    };
    search: {
      issuesAndPullRequests: (
        _args: unknown,
      ) => Promise<OctokitResponse<{ total_count: number; items: unknown[] }>>;
    };
  };
  graphql: (_query: string, _vars?: unknown) => Promise<unknown>;
} | null = null;

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async () => mockUserOctokit,
}));

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
        listWorkflowRunsForRepo: async (): Promise<
          OctokitResponse<{ workflow_runs: MockWorkflowRun[] }>
        > => {
          if (mockWorkflowRunsError) throw mockWorkflowRunsError;
          return { data: { workflow_runs: mockWorkflowRuns } };
        },
      },
      checks: {
        listForRef: async (): Promise<
          OctokitResponse<{ check_runs: MockCheckRun[] }>
        > => {
          return { data: { check_runs: mockCheckRuns } };
        },
      },
      search: {
        issuesAndPullRequests: async (): Promise<
          OctokitResponse<{ total_count: number; items: unknown[] }>
        > => {
          if (mockIssueSearchError) throw mockIssueSearchError;
          return {
            data: {
              total_count: mockIssueSearchTotalCount ?? mockIssueList.length,
              items: [],
            },
          };
        },
      },
    },
    graphql: async (_query: string, _vars?: unknown): Promise<unknown> => {
      if (mockIssueSearchError) throw mockIssueSearchError;
      return {
        repository: {
          issues: {
            totalCount: mockIssueSearchTotalCount ?? mockIssueList.length,
          },
        },
      };
    },
  };
}

describe("Helper review-fix: BLOCKER 3 — true open issue count", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockIssueSearchTotalCount = null;
    mockIssueSearchError = null;
    mockUserOctokit = makeMockOctokit();
  });

  // BLOCKER3-A: When there are 200 open issues but the page returns 20,
  // totalOpen must reflect 200, not 20.
  test("BLOCKER3-A: totalOpen reflects true count (200) when page returns only 20 issues", async () => {
    // Simulate 20 issues in the page (API returns at most 20 per page)
    mockIssueList = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      labels: [],
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/acme/widgets/issues/${i + 1}`,
    }));

    // True count is 200 (from search/GraphQL)
    mockIssueSearchTotalCount = 200;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) {
      throw new Error(
        `Expected ok issueSummary, got ${result.issueSummary.errorKind}`,
      );
    }

    // Must show the TRUE count, not recent.length
    expect(result.issueSummary.totalOpen).toBe(200);
    // But recent list is still bounded at 20
    expect(result.issueSummary.recent.length).toBeLessThanOrEqual(20);
  });

  // BLOCKER3-B: totalOpen must not be depressed when PRs dominate the page
  // (GitHub issues API returns PRs too; after filtering, totalOpen should still be true)
  test("BLOCKER3-B: totalOpen is not depressed when PRs dominate the bounded page", async () => {
    // 15 of 20 items are PRs — only 5 real issues in the page
    mockIssueList = [
      ...Array.from({ length: 15 }, (_, i) => ({
        number: i + 1,
        title: `PR ${i + 1}`,
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: `https://github.com/acme/widgets/issues/${i + 1}`,
        pull_request: {
          url: `https://api.github.com/repos/acme/widgets/pulls/${i + 1}`,
        },
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        number: 100 + i,
        title: `Real issue ${i + 1}`,
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: `https://github.com/acme/widgets/issues/${100 + i}`,
      })),
    ];
    // True open issue count (from search)
    mockIssueSearchTotalCount = 42;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) {
      throw new Error("Expected ok issueSummary");
    }

    // totalOpen must be the true count, not 5 (filtered page)
    expect(result.issueSummary.totalOpen).toBe(42);
  });
});

describe("Helper review-fix: BLOCKER 4 — real PR checksStatus", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockIssueSearchTotalCount = null;
    mockIssueSearchError = null;
    mockUserOctokit = makeMockOctokit();
  });

  // BLOCKER4-A: A PR with a failing check run → checksStatus must be "failing"
  test("BLOCKER4-A: PR with failing check run yields checksStatus: 'failing'", async () => {
    mockPrList = [
      {
        number: 42,
        title: "feat: new feature",
        draft: false,
        state: "open",
        user: { login: "alice" },
        base: { ref: "main" },
        head: { sha: "sha-failing" },
        html_url: "https://github.com/acme/widgets/pull/42",
        updated_at: new Date().toISOString(),
      },
    ];

    // Mock checks.listForRef to return a failing check
    mockCheckRuns = [
      {
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "failure",
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) {
      throw new Error(
        `Expected ok prSummary, got ${result.prSummary.errorKind}`,
      );
    }

    const pr = result.prSummary.prs[0];
    if (!pr) throw new Error("Expected at least one PR");

    // Must NOT be "unknown" — must reflect the real check state
    expect(pr.checksStatus).toBe("failing");
  });

  // BLOCKER4-B: A PR with all passing check runs → checksStatus must be "passing"
  test("BLOCKER4-B: PR with all passing check runs yields checksStatus: 'passing'", async () => {
    mockPrList = [
      {
        number: 7,
        title: "fix: bug fix",
        draft: false,
        state: "open",
        user: { login: "bob" },
        base: { ref: "main" },
        head: { sha: "sha-passing" },
        html_url: "https://github.com/acme/widgets/pull/7",
        updated_at: new Date().toISOString(),
      },
    ];

    mockCheckRuns = [
      {
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "success",
      },
      {
        id: 2,
        name: "lint",
        status: "completed",
        conclusion: "success",
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
    expect(pr.checksStatus).toBe("passing");
  });

  // BLOCKER4-C: A PR with a pending check run → checksStatus must be "pending"
  test("BLOCKER4-C: PR with in-progress check run yields checksStatus: 'pending'", async () => {
    mockPrList = [
      {
        number: 11,
        title: "chore: update deps",
        draft: false,
        state: "open",
        user: { login: "carol" },
        base: { ref: "develop" },
        head: { sha: "sha-pending" },
        html_url: "https://github.com/acme/widgets/pull/11",
        updated_at: new Date().toISOString(),
      },
    ];

    mockCheckRuns = [
      {
        id: 1,
        name: "CI",
        status: "in_progress",
        conclusion: null,
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
    expect(pr.checksStatus).toBe("pending");
  });

  // BLOCKER4-D: Draft PR is identified by isDraft flag (already works but part of the bucket spec)
  test("BLOCKER4-D: draft PR has isDraft=true in the summary", async () => {
    mockPrList = [
      {
        number: 55,
        title: "WIP: experimental change",
        draft: true,
        state: "open",
        user: { login: "dave" },
        base: { ref: "main" },
        head: { sha: "sha-draft" },
        html_url: "https://github.com/acme/widgets/pull/55",
        updated_at: new Date().toISOString(),
      },
    ];
    mockCheckRuns = [];

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
    expect(pr.isDraft).toBe(true);
  });
});

describe("Helper review-fix: MEDIUM — 403 with rate-limit signal → provider_rate_limited", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockIssueSearchTotalCount = null;
    mockIssueSearchError = null;
    mockUserOctokit = makeMockOctokit();
  });

  // MEDIUM-A: 403 + rate-limit message → provider_rate_limited (NOT repo_access_denied)
  test("MEDIUM-A: 403 with 'rate limit' in message maps to provider_rate_limited, not repo_access_denied", async () => {
    const rateLimitErr = new Error("API rate limit exceeded for token");
    Object.assign(rateLimitErr, { status: 403 });
    mockPrListError = rateLimitErr;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.prSummary.ok).toBe(false);
    if (!result.prSummary.ok) {
      // Must be rate_limited, NOT repo_access_denied
      expect(result.prSummary.errorKind).toBe("provider_rate_limited");
    }
  });

  // MEDIUM-B: 403 without rate-limit message → repo_access_denied (existing behavior preserved)
  test("MEDIUM-B: plain 403 without rate-limit message still maps to repo_access_denied", async () => {
    const accessDeniedErr = new Error("Forbidden");
    Object.assign(accessDeniedErr, { status: 403 });
    mockPrListError = accessDeniedErr;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.prSummary.ok).toBe(false);
    if (!result.prSummary.ok) {
      expect(result.prSummary.errorKind).toBe("repo_access_denied");
    }
  });
});
