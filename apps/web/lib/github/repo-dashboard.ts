import "server-only";

import { getUserOctokit } from "./client";

// ---- Error taxonomy -------------------------------------------------------

export type DashboardErrorKind =
  | "github_not_connected"
  | "repo_access_denied"
  | "installation_missing"
  | "app_no_access"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "invalid_repo"
  | "unknown_dashboard_failure";

// ---- PR summary types -----------------------------------------------------

export type PrItem = {
  number: number;
  title: string;
  isDraft: boolean;
  author: string | null;
  baseBranch: string;
  updatedAt: string;
  checksStatus: "passing" | "failing" | "pending" | "unknown";
  url: string;
};

export type PrSummaryOk = {
  ok: true;
  prs: PrItem[];
};

export type PrSummaryError = {
  ok: false;
  errorKind: DashboardErrorKind;
};

export type PrSummary = PrSummaryOk | PrSummaryError;

// ---- Issue summary types --------------------------------------------------

export type IssueItem = {
  number: number;
  title: string;
  labels: string[];
  updatedAt: string;
  url: string;
};

export type IssueSummaryOk = {
  ok: true;
  totalOpen: number;
  recent: IssueItem[];
};

export type IssueSummaryError = {
  ok: false;
  errorKind: DashboardErrorKind;
};

export type IssueSummary = IssueSummaryOk | IssueSummaryError;

// ---- Actions/checks summary types -----------------------------------------

export type ActionRunItem = {
  runId: number;
  name: string;
  conclusion: string | null;
  status: string;
  createdAt: string;
  url: string;
};

export type ActionsSummaryOk = {
  ok: true;
  latestStatus: "passing" | "failing" | "pending";
  recentRuns: ActionRunItem[];
};

export type ActionsSummaryError = {
  ok: false;
  errorKind: DashboardErrorKind;
};

export type ActionsSummary = ActionsSummaryOk | ActionsSummaryError;

// ---- Result type ----------------------------------------------------------

export type RepoDashboardData = {
  prSummary: PrSummary;
  issueSummary: IssueSummary;
  actionsSummary: ActionsSummary;
};

// ---- Bounded limits -------------------------------------------------------

const PR_LIMIT = 20;
const ISSUE_LIMIT = 20;
const WORKFLOW_RUN_LIMIT = 10;

// ---- Error classification -------------------------------------------------

function classifyGitHubError(error: unknown): DashboardErrorKind {
  if (!error || typeof error !== "object") {
    return "unknown_dashboard_failure";
  }

  // Check rate-limit signals BEFORE mapping 403 to repo_access_denied.
  // GitHub returns 403 for secondary rate limits too.
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  if (message.includes("rate limit") || message.includes("rate limited")) {
    return "provider_rate_limited";
  }

  // Check headers for rate-limit signals (x-ratelimit-remaining: 0)
  const headers =
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "headers" in error.response
      ? (error.response as { headers?: Record<string, string> }).headers
      : null;

  if (headers) {
    const remaining = headers["x-ratelimit-remaining"];
    const retryAfter = headers["retry-after"];
    if (remaining === "0" || retryAfter) {
      return "provider_rate_limited";
    }
  }

  const httpStatus = getHttpStatus(error);

  if (httpStatus === 401) {
    return "repo_access_denied";
  }

  if (httpStatus === 403) {
    return "repo_access_denied";
  }

  if (httpStatus === 404) {
    return "invalid_repo";
  }

  if (httpStatus === 429) {
    return "provider_rate_limited";
  }

  if (httpStatus && httpStatus >= 500) {
    return "provider_unavailable";
  }

  return "provider_unavailable";
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidates = [
    (error as { status?: unknown }).status,
    (error as { response?: { status?: unknown } }).response?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return null;
}

// ---- PR check-status rollup -----------------------------------------------

function resolveChecksStatus(
  checkRuns: Array<{ status: string; conclusion: string | null }>,
): "passing" | "failing" | "pending" | "unknown" {
  if (checkRuns.length === 0) {
    return "unknown";
  }

  // If any check is in progress, status is pending
  const hasPending = checkRuns.some(
    (c) => c.status !== "completed",
  );
  if (hasPending) {
    return "pending";
  }

  const failConclusions = new Set([
    "failure",
    "cancelled",
    "action_required",
    "timed_out",
    "startup_failure",
  ]);

  const hasFailing = checkRuns.some(
    (c) => c.conclusion && failConclusions.has(c.conclusion),
  );
  if (hasFailing) {
    return "failing";
  }

  const successConclusions = new Set(["success", "neutral", "skipped"]);
  const allSuccess = checkRuns.every(
    (c) => c.conclusion && successConclusions.has(c.conclusion),
  );
  if (allSuccess) {
    return "passing";
  }

  return "unknown";
}

// ---- PR fetcher -----------------------------------------------------------

async function fetchPrSummary(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
): Promise<PrSummary> {
  try {
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: PR_LIMIT,
    });

    const prs: PrItem[] = await Promise.all(
      response.data.slice(0, PR_LIMIT).map(async (pr) => {
        let checksStatus: PrItem["checksStatus"] = "unknown";
        try {
          const checksResponse = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: pr.head.sha,
            per_page: 100,
          });
          checksStatus = resolveChecksStatus(checksResponse.data.check_runs);
        } catch {
          // check fetch failure is non-fatal — fall back to "unknown"
        }

        return {
          number: pr.number,
          title: pr.title,
          isDraft: Boolean(pr.draft),
          author: pr.user?.login ?? null,
          baseBranch: pr.base.ref,
          updatedAt: pr.updated_at,
          checksStatus,
          url: pr.html_url,
        };
      }),
    );

    return { ok: true, prs };
  } catch (error: unknown) {
    return { ok: false, errorKind: classifyGitHubError(error) };
  }
}

// ---- Issue fetcher --------------------------------------------------------

async function fetchIssueSummary(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
): Promise<IssueSummary> {
  try {
    // Fetch the bounded page for recent display
    const pageResponse = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: ISSUE_LIMIT,
    });

    // GitHub issues API returns PRs too — filter them out
    const issueItems = pageResponse.data.filter((item) => !item.pull_request);

    const recent: IssueItem[] = issueItems
      .slice(0, ISSUE_LIMIT)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        labels: issue.labels
          .map((label) =>
            typeof label === "string" ? label : (label.name ?? ""),
          )
          .filter(Boolean),
        updatedAt: issue.updated_at,
        url: issue.html_url,
      }));

    // Get the TRUE open-issue count via a bounded search call.
    // This avoids the bug where totalOpen == recent.length when the repo
    // has more than ISSUE_LIMIT open issues or when PRs dominate the page.
    let totalOpen = recent.length;
    try {
      const searchResponse = await octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:issue is:open`,
        per_page: 1,
      });
      totalOpen = searchResponse.data.total_count;
    } catch {
      // Search API failure is non-fatal — fall back to recent.length as a floor
      totalOpen = recent.length;
    }

    return {
      ok: true,
      totalOpen,
      recent,
    };
  } catch (error: unknown) {
    return { ok: false, errorKind: classifyGitHubError(error) };
  }
}

// ---- Actions/workflow fetcher ---------------------------------------------

function resolveLatestStatus(
  runs: Array<{ conclusion: string | null; status: string }>,
): "passing" | "failing" | "pending" {
  if (runs.length === 0) {
    return "passing";
  }

  const latest = runs[0];
  if (!latest) {
    return "passing";
  }

  if (latest.status !== "completed") {
    return "pending";
  }

  const successConclusions = new Set(["success", "neutral", "skipped"]);
  const failConclusions = new Set([
    "failure",
    "cancelled",
    "action_required",
    "timed_out",
    "startup_failure",
  ]);

  if (latest.conclusion && successConclusions.has(latest.conclusion)) {
    return "passing";
  }

  if (latest.conclusion && failConclusions.has(latest.conclusion)) {
    return "failing";
  }

  return "pending";
}

async function fetchActionsSummary(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
): Promise<ActionsSummary> {
  try {
    const response = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: WORKFLOW_RUN_LIMIT,
    });

    const recentRuns: ActionRunItem[] = response.data.workflow_runs
      .slice(0, WORKFLOW_RUN_LIMIT)
      .map((run) => ({
        runId: run.id,
        name: run.name ?? "Workflow",
        conclusion: run.conclusion ?? null,
        status: run.status ?? "unknown",
        createdAt: run.created_at,
        url: run.html_url,
      }));

    return {
      ok: true,
      latestStatus: resolveLatestStatus(recentRuns),
      recentRuns,
    };
  } catch (error: unknown) {
    return { ok: false, errorKind: classifyGitHubError(error) };
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Fetch all three GitHub dashboard windows in parallel with independent
 * failure isolation. A failure in one window does NOT fail the others.
 *
 * REDACTION CONTRACT: Never log or return raw GitHub payloads, OAuth tokens,
 * installation tokens, or authorization headers. Only bounded title/summary
 * fields from PRs and issues are exposed to callers.
 */
export async function getRepoDashboardData(params: {
  userId: string;
  owner: string;
  repo: string;
}): Promise<RepoDashboardData> {
  const { userId, owner, repo } = params;

  const octokit = await getUserOctokit(userId);

  if (!octokit) {
    const notConnected: PrSummaryError = {
      ok: false,
      errorKind: "github_not_connected",
    };
    return {
      prSummary: notConnected,
      issueSummary: { ok: false, errorKind: "github_not_connected" },
      actionsSummary: { ok: false, errorKind: "github_not_connected" },
    };
  }

  // Fetch all three windows in parallel — each is independently isolated
  const [prSummary, issueSummary, actionsSummary] = await Promise.all([
    fetchPrSummary(octokit, owner, repo),
    fetchIssueSummary(octokit, owner, repo),
    fetchActionsSummary(octokit, owner, repo),
  ]);

  return { prSummary, issueSummary, actionsSummary };
}
