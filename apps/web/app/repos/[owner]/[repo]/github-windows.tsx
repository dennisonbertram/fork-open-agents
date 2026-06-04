import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type {
  PrSummary,
  IssueSummary,
  ActionsSummary,
} from "@/lib/github/repo-dashboard";

// Re-export types so tests can import them directly from this module
export type {
  PrSummary,
  IssueSummary,
  ActionsSummary,
} from "@/lib/github/repo-dashboard";

// ---- helpers ---------------------------------------------------------------

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function errorMessage(errorKind: string): string {
  switch (errorKind) {
    case "github_not_connected":
      return "GitHub not connected. Connect your account in Settings to see live data.";
    case "app_no_access":
      return "GitHub App does not have access to this repo. An org admin needs to update the app's repository permissions.";
    case "installation_missing":
      return "GitHub App is not installed for this organization. Install it from Settings > Connections.";
    case "provider_rate_limited":
      return "GitHub rate limit reached. Data will refresh when the limit resets.";
    case "provider_unavailable":
      return "Could not load data from GitHub. This may be a temporary outage.";
    case "repo_access_denied":
      return "Access denied to this repository.";
    default:
      return "GitHub data could not be loaded.";
  }
}

// ---- Pull Requests window -------------------------------------------------

type PullRequestsWindowProps = {
  summary: PrSummary;
  owner: string;
  repo: string;
};

export function PullRequestsWindow({
  summary,
  owner,
  repo,
}: PullRequestsWindowProps) {
  return (
    <section
      aria-label="Pull Requests window"
      className="rounded-md border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Pull Requests</h2>
        <Link
          href={`https://github.com/${owner}/${repo}/pulls`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Open pull requests on GitHub"
        >
          View on GitHub
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {!summary.ok ? (
        <div className="p-4 text-sm text-muted-foreground">
          {errorMessage(summary.errorKind)}
        </div>
      ) : summary.prs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No open pull requests.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {summary.prs.map((pr) => (
            <Link
              key={pr.number}
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      #{pr.number}
                    </span>
                    {pr.isDraft && (
                      <span className="shrink-0 rounded border border-border bg-muted/40 px-1 py-0.5 text-[9px] text-muted-foreground">
                        draft
                      </span>
                    )}
                    {pr.checksStatus === "failing" && (
                      <span className="shrink-0 rounded border border-red-500/25 bg-red-500/10 px-1 py-0.5 text-[9px] text-red-700 dark:text-red-300">
                        checks failing
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm">{pr.title}</p>
                  {pr.author && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {pr.author} → {pr.baseBranch}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatUpdated(pr.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Issues window --------------------------------------------------------

type IssuesWindowProps = {
  summary: IssueSummary;
  owner: string;
  repo: string;
};

export function IssuesWindow({ summary, owner, repo }: IssuesWindowProps) {
  return (
    <section
      aria-label="Issues window"
      className="rounded-md border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Issues</h2>
        <Link
          href={`https://github.com/${owner}/${repo}/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Open issues on GitHub"
        >
          View on GitHub
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {!summary.ok ? (
        <div className="p-4 text-sm text-muted-foreground">
          {errorMessage(summary.errorKind)}
        </div>
      ) : summary.totalOpen === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No open issues.
        </div>
      ) : (
        <>
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {summary.totalOpen}
              </span>{" "}
              open
            </p>
          </div>
          <div className="divide-y divide-border">
            {summary.recent.map((issue) => (
              <Link
                key={issue.number}
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        #{issue.number}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm">{issue.title}</p>
                    {issue.labels.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {issue.labels.slice(0, 3).map((label) => (
                          <span
                            key={label}
                            className="rounded border border-border bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatUpdated(issue.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---- Actions window -------------------------------------------------------

type ActionsWindowProps = {
  summary: ActionsSummary;
  owner: string;
  repo: string;
};

function latestStatusLabel(status: "passing" | "failing" | "pending"): string {
  switch (status) {
    case "passing":
      return "passing";
    case "failing":
      return "failing";
    case "pending":
      return "in progress";
  }
}

export function ActionsWindow({ summary, owner, repo }: ActionsWindowProps) {
  return (
    <section
      aria-label="Actions window"
      className="rounded-md border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Actions</h2>
        <Link
          href={`https://github.com/${owner}/${repo}/actions`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Open actions on GitHub"
        >
          View on GitHub
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {!summary.ok ? (
        <div className="p-4 text-sm text-muted-foreground">
          {errorMessage(summary.errorKind)}
        </div>
      ) : summary.recentRuns.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No workflow runs recorded.
        </div>
      ) : (
        <>
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs text-muted-foreground">
              Latest:{" "}
              <span
                className={
                  summary.latestStatus === "passing"
                    ? "font-medium text-emerald-700 dark:text-emerald-300"
                    : summary.latestStatus === "failing"
                      ? "font-medium text-red-700 dark:text-red-300"
                      : "font-medium text-amber-700 dark:text-amber-300"
                }
              >
                {latestStatusLabel(summary.latestStatus)}
              </span>
            </p>
          </div>
          <div className="divide-y divide-border">
            {summary.recentRuns.map((run) => (
              <Link
                key={run.runId}
                href={run.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <p className="truncate text-sm">{run.name}</p>
                <span
                  className={
                    run.conclusion === "success" ||
                    run.conclusion === "neutral" ||
                    run.conclusion === "skipped"
                      ? "shrink-0 text-[10px] text-emerald-700 dark:text-emerald-300"
                      : run.conclusion === "failure" ||
                          run.conclusion === "cancelled" ||
                          run.conclusion === "timed_out"
                        ? "shrink-0 text-[10px] text-red-700 dark:text-red-300"
                        : "shrink-0 text-[10px] text-muted-foreground"
                  }
                >
                  {run.conclusion ?? run.status}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
