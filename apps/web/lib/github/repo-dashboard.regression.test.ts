/**
 * Regression tests for repo-dashboard.ts
 *
 * These tests would fail if the implementation were reverted to returning
 * a single aggregate failure instead of per-window isolated failures.
 *
 * REGRESSION contract:
 * - The dashboard NEVER fails entirely because one GitHub subquery failed.
 * - The error taxonomy NEVER changes errorKind values silently.
 * - Bounded limits are honored (no full-history pagination).
 * - PR-shaped items are always excluded from the issues list.
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

let mockPrListError: Error | null = null;
let mockIssueListError: Error | null = null;
let mockWorkflowRunsError: Error | null = null;
let mockPrList: MockPr[] = [];
let mockIssueList: MockIssue[] = [];
let mockWorkflowRuns: MockWorkflowRun[] = [];

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
        listForRef: async (): Promise<OctokitResponse<{ check_runs: [] }>> => {
          return { data: { check_runs: [] } };
        },
      },
    },
  }),
}));

const helperModulePromise = import("./repo-dashboard");

describe("Regression: repo-dashboard partial-failure isolation", () => {
  beforeEach(() => {
    mockPrListError = null;
    mockIssueListError = null;
    mockWorkflowRunsError = null;
    mockPrList = [];
    mockIssueList = [];
    mockWorkflowRuns = [];
  });

  // REGRESSION-D-001: All three windows fail independently
  // If isolation is broken, this would fail because one error would cascade
  test("REGRESSION-D-001: all three windows can fail independently without cascading", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    mockPrListError = err429;
    mockIssueListError = Object.assign(new Error("server error"), {
      status: 500,
    });
    mockWorkflowRunsError = Object.assign(new Error("not found"), {
      status: 404,
    });

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // Each window has its own errorKind — NOT the same generic error
    expect(result.prSummary.ok).toBe(false);
    expect(result.issueSummary.ok).toBe(false);
    expect(result.actionsSummary.ok).toBe(false);

    if (!result.prSummary.ok) {
      expect(result.prSummary.errorKind).toBe("provider_rate_limited");
    }
    if (!result.issueSummary.ok) {
      // 500 → provider_unavailable
      expect(result.issueSummary.errorKind).toBe("provider_unavailable");
    }
    if (!result.actionsSummary.ok) {
      // 404 → invalid_repo
      expect(result.actionsSummary.errorKind).toBe("invalid_repo");
    }
  });

  // REGRESSION-D-002: PR failure does not affect issues or actions
  // If Promise.allSettled isolation is removed, this test fails
  test("REGRESSION-D-002: when only PRs fail, issues and actions windows still succeed", async () => {
    mockPrListError = new Error("only PR fails");
    mockIssueList = [
      {
        number: 3,
        title: "Button misaligned",
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: "https://github.com/acme/widgets/issues/3",
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    // PRs failed
    expect(result.prSummary.ok).toBe(false);
    // Issues succeeded with data
    expect(result.issueSummary.ok).toBe(true);
    if (result.issueSummary.ok) {
      expect(result.issueSummary.recent).toHaveLength(1);
      expect(result.issueSummary.recent[0]?.title).toBe("Button misaligned");
    }
    // Actions succeeded (no error)
    expect(result.actionsSummary.ok).toBe(true);
  });

  // REGRESSION-D-003: PR list is bounded at 20 items
  // If the limit constant is removed, this test fails because 25 items would come through
  test("REGRESSION-D-003: PR list is always bounded at max 20 items even when provider returns more", async () => {
    mockPrList = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      draft: false,
      state: "open",
      user: { login: "alice" },
      base: { ref: "main" },
      head: { sha: `sha${i}` },
      html_url: `https://github.com/acme/widgets/pull/${i + 1}`,
      updated_at: new Date().toISOString(),
    }));

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) throw new Error("Expected ok result");
    // Must be bounded — never return all 25
    expect(result.prSummary.prs.length).toBeLessThanOrEqual(20);
  });

  // REGRESSION-D-004: PR-shaped items are permanently excluded from issue list
  // If the pull_request filter is removed, item #2 would leak into results
  test("REGRESSION-D-004: items with pull_request field are always excluded from issue summary", async () => {
    mockIssueList = [
      {
        number: 1,
        title: "Actual issue",
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: "https://github.com/acme/widgets/issues/1",
      },
      {
        number: 2,
        title: "PR masquerading as issue",
        labels: [],
        updated_at: new Date().toISOString(),
        html_url: "https://github.com/acme/widgets/issues/2",
        pull_request: {
          url: "https://api.github.com/repos/acme/widgets/pulls/2",
        },
      },
    ];

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.issueSummary.ok) throw new Error("Expected ok result");
    const numbers = result.issueSummary.recent.map((i) => i.number);
    // PR #2 must NEVER appear in the issue list
    expect(numbers).not.toContain(2);
    expect(numbers).toContain(1);
  });

  // REGRESSION-D-005: errorKind taxonomy — stable values
  // If any errorKind string is renamed, clients will break
  test("REGRESSION-D-005: errorKind 'provider_rate_limited' is returned for 429 status", async () => {
    const err = Object.assign(new Error("rate limit exceeded"), {
      status: 429,
    });
    mockPrListError = err;
    mockIssueListError = err;
    mockWorkflowRunsError = err;

    const { getRepoDashboardData } = await helperModulePromise;
    const result = await getRepoDashboardData({
      userId: "user-1",
      owner: "acme",
      repo: "widgets",
    });

    if (!result.prSummary.ok) {
      expect(result.prSummary.errorKind).toBe("provider_rate_limited");
    }
    if (!result.issueSummary.ok) {
      expect(result.issueSummary.errorKind).toBe("provider_rate_limited");
    }
    if (!result.actionsSummary.ok) {
      expect(result.actionsSummary.errorKind).toBe("provider_rate_limited");
    }
  });

  // REGRESSION-D-006: github_not_connected when no octokit
  // If the null-octokit check is removed, calling octokit.rest would throw an unhandled error
  test("REGRESSION-D-006: all windows return github_not_connected when octokit is null", async () => {
    // Temporarily override getUserOctokit to return null
    mock.module("@/lib/github/client", () => ({
      getUserOctokit: async () => null,
    }));

    // Re-import to pick up the new mock
    const { getRepoDashboardData: getFreshData } =
      await import("./repo-dashboard");
    const result = await getFreshData({
      userId: "user-no-token",
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
});
