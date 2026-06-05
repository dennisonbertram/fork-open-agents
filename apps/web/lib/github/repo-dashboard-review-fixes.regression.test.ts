/**
 * Regression tests for #162 review-fix blockers.
 * These would fail if the fixes were reverted.
 *
 * REGRESSION contract:
 * - totalOpen must never equal recent.length when the search API returns more
 * - checksStatus must never be hardcoded "unknown" when checks are available
 * - 403 + rate-limit message must always be classified as provider_rate_limited
 * - route.ts partial isolation: a rejected local data source must never cause a 500
 * - app_no_access / installation_missing must override OAuth window data
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
let mockSearchTotalCount = 0;
let mockSearchError: Error | null = null;

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async () => ({
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
          if (mockSearchError) throw mockSearchError;
          return { data: { total_count: mockSearchTotalCount, items: [] } };
        },
      },
    },
  }),
}));

const helperModulePromise = import("./repo-dashboard");

describe("Regression: #162 review-fix — true issue count must never equal page size", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockSearchTotalCount = 0;
    mockSearchError = null;
  });

  // REGRESSION-RF-001: If search API is present and returns 350, totalOpen must be 350
  // (not capped to the page size of 20)
  test("REGRESSION-RF-001: totalOpen reflects search API total_count when available", async () => {
    mockIssueList = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      labels: [],
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/acme/widgets/issues/${i + 1}`,
    }));
    mockSearchTotalCount = 350;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) throw new Error("Expected ok");
    // Must NEVER be 20 (page size) when search returns 350
    expect(result.issueSummary.totalOpen).toBe(350);
  });

  // REGRESSION-RF-002: Search API failure must not break issue summary
  // (falls back to recent.length gracefully)
  test("REGRESSION-RF-002: search API failure falls back gracefully, issue summary still ok", async () => {
    mockIssueList = [
      {
        number: 1,
        title: "Bug",
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: "https://github.com/acme/widgets/issues/1",
      },
    ];
    mockSearchError = new Error("Search API unavailable");

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // Issue summary must still succeed — search failure is non-fatal
    expect(result.issueSummary.ok).toBe(true);
    if (result.issueSummary.ok) {
      // Falls back to the filtered page count
      expect(result.issueSummary.totalOpen).toBe(1);
    }
  });
});

describe("Regression: #162 review-fix — checksStatus must never be hardcoded", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockSearchTotalCount = 0;
    mockSearchError = null;
  });

  // REGRESSION-RF-003: If checks return failure, checksStatus CANNOT be "unknown"
  test("REGRESSION-RF-003: checksStatus is 'failing' not 'unknown' when checks fail", async () => {
    mockPrList = [
      {
        number: 1,
        title: "PR with failing checks",
        draft: false,
        state: "open",
        user: { login: "alice" },
        base: { ref: "main" },
        head: { sha: "sha-001" },
        html_url: "https://github.com/acme/widgets/pull/1",
        updated_at: new Date().toISOString(),
      },
    ];
    mockCheckRuns = [
      { id: 1, name: "CI", status: "completed", conclusion: "failure" },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) throw new Error("Expected ok");
    const pr = result.prSummary.prs[0];
    if (!pr) throw new Error("Expected PR");
    // Must NEVER be "unknown" when checks return a real result
    expect(pr.checksStatus).not.toBe("unknown");
    expect(pr.checksStatus).toBe("failing");
  });
});

describe("Regression: #162 review-fix — 403 + rate-limit signal must not be access-denied", () => {
  beforeEach(() => {
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
    mockCheckRuns = [];
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockSearchTotalCount = 0;
    mockSearchError = null;
  });

  // REGRESSION-RF-004: The earlier bug was: 403 always → repo_access_denied.
  // This test catches any regression where the rate-limit check is removed.
  test("REGRESSION-RF-004: 403 with 'rate limit exceeded' message always yields provider_rate_limited", async () => {
    const err = new Error("API rate limit exceeded for token");
    Object.assign(err, { status: 403 });
    mockPrListError = err;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.prSummary.ok).toBe(false);
    if (!result.prSummary.ok) {
      // Must NEVER be "repo_access_denied" when the message contains "rate limit"
      expect(result.prSummary.errorKind).not.toBe("repo_access_denied");
      expect(result.prSummary.errorKind).toBe("provider_rate_limited");
    }
  });
});
