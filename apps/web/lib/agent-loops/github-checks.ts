/**
 * Agent Loops — GitHub check functions
 *
 * Four typed functions, one per check kind.  Each accepts:
 *   - owner / repo / token for API authentication
 *   - the check config from the node definition
 * and returns a typed normalized output shape (never raw API response).
 *
 * Normalized shapes are documented alongside each function and MUST be
 * stable across GitHub API changes (we extract only the fields we publish).
 * List sizes are capped at MAX_LIST_SIZE to respect the 64KB context cap.
 *
 * No I/O beyond the GitHub REST API.  No DB.  No LLM.
 * Never throws — callers handle caught errors as github_check_failed.
 */

import { Octokit } from "@octokit/rest";

/** Maximum list items returned by any check (context cap guard). */
export const MAX_LIST_SIZE = 20;

// ── Normalized output types ───────────────────────────────────────────────────

/** Normalized output for github_check kind="list_issues" */
export type ListIssuesOutput = {
  openIssueCount: number;
  issues: Array<{
    number: number;
    title: string;
    labels: string[];
    url: string;
  }>;
};

/** Normalized output for github_check kind="pr_status" */
export type PrStatusOutput = {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  url: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  mergeable: boolean | null;
};

/** Normalized output for github_check kind="deployment_status" */
export type DeploymentStatusOutput = {
  environment: string;
  latestState: string | null;
  deploymentCount: number;
  deployments: Array<{
    id: number;
    state: string;
    createdAt: string;
    logUrl: string | null;
  }>;
};

/** Normalized output for github_check kind="ci_status" */
export type CiStatusOutput = {
  ref: string;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  pendingCount: number;
  checkRuns: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
  }>;
};

// ── list_issues ───────────────────────────────────────────────────────────────

/**
 * Lists GitHub issues for a repo filtered by labels and/or state.
 * Returns normalized output capped at MAX_LIST_SIZE items.
 */
export async function checkListIssues(params: {
  owner: string;
  repo: string;
  token: string;
  labels?: string[];
  state?: "open" | "closed";
}): Promise<ListIssuesOutput> {
  const octokit = new Octokit({ auth: params.token });

  const response = await octokit.rest.issues.listForRepo({
    owner: params.owner,
    repo: params.repo,
    labels: params.labels?.join(","),
    state: params.state ?? "open",
    per_page: MAX_LIST_SIZE,
  });

  const raw = response.data;
  const issues = raw.slice(0, MAX_LIST_SIZE).map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels ?? []).map((l) =>
      typeof l === "string" ? l : (l.name ?? ""),
    ),
    url: issue.html_url,
  }));

  return {
    openIssueCount: issues.length,
    issues,
  };
}

// ── pr_status ─────────────────────────────────────────────────────────────────

/**
 * Fetches PR status for a specific PR number.
 * The PR number is resolved from context by the executor before calling here.
 */
export async function checkPrStatus(params: {
  owner: string;
  repo: string;
  token: string;
  prNumber: number;
}): Promise<PrStatusOutput> {
  const octokit = new Octokit({ auth: params.token });

  const response = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
  });

  const pr = response.data;

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: pr.merged ?? false,
    draft: pr.draft ?? false,
    url: pr.html_url,
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    mergeable: pr.mergeable ?? null,
  };
}

// ── deployment_status ─────────────────────────────────────────────────────────

/**
 * Fetches deployment status, optionally filtered to a specific environment.
 * Returns the latest deployment state.
 */
export async function checkDeploymentStatus(params: {
  owner: string;
  repo: string;
  token: string;
  environment?: string;
}): Promise<DeploymentStatusOutput> {
  const octokit = new Octokit({ auth: params.token });

  const response = await octokit.rest.deployments.list({
    owner: params.owner,
    repo: params.repo,
    environment: params.environment,
    per_page: MAX_LIST_SIZE,
  });

  const rawDeployments = response.data.slice(0, MAX_LIST_SIZE);

  // Get statuses for each deployment (first one is most recent)
  let latestState: string | null = null;

  const deployments = await Promise.all(
    rawDeployments.map(async (dep) => {
      let state = "unknown";
      try {
        const statusResponse = await octokit.rest.deployments.listDeploymentStatuses({
          owner: params.owner,
          repo: params.repo,
          deployment_id: dep.id,
          per_page: 1,
        });
        state = statusResponse.data[0]?.state ?? "unknown";
      } catch {
        // If we can't get deployment statuses, report as unknown
      }
      return {
        id: dep.id,
        state,
        createdAt: dep.created_at,
        logUrl: null as string | null,
      };
    }),
  );

  if (deployments.length > 0) {
    latestState = deployments[0]?.state ?? null;
  }

  return {
    environment: params.environment ?? "default",
    latestState,
    deploymentCount: deployments.length,
    deployments,
  };
}

// ── ci_status ─────────────────────────────────────────────────────────────────

/**
 * Fetches CI check runs for a specific git ref (SHA or branch name).
 * The ref is resolved from context by the executor before calling here.
 */
export async function checkCiStatus(params: {
  owner: string;
  repo: string;
  token: string;
  ref: string;
}): Promise<CiStatusOutput> {
  const octokit = new Octokit({ auth: params.token });

  const response = await octokit.rest.checks.listForRef({
    owner: params.owner,
    repo: params.repo,
    ref: params.ref,
    per_page: MAX_LIST_SIZE,
  });

  const rawRuns = response.data.check_runs.slice(0, MAX_LIST_SIZE);

  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  const checkRuns = rawRuns.map((run) => {
    if (run.status === "completed") {
      if (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped") {
        passedCount++;
      } else if (run.conclusion != null) {
        failedCount++;
      } else {
        pendingCount++;
      }
    } else {
      pendingCount++;
    }
    return {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
    };
  });

  return {
    ref: params.ref,
    totalCount: checkRuns.length,
    passedCount,
    failedCount,
    pendingCount,
    checkRuns,
  };
}
