import { ExternalLink, Github, Settings } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  githubRepositoryUrl,
  repositoryAutomationsUrl,
  repositoryRunsUrl,
  repositorySettingsUrl,
} from "@/lib/repositories/routes";
import type {
  RepositoryDashboardSummary,
  RepositorySummaryValue,
} from "./repository-dashboard-summary";
import { RepositoryNewSessionAction } from "./repository-new-session-action";

function AutomationSummary({ value }: { value: RepositorySummaryValue }) {
  if (value.status === "error") {
    return (
      <p className="text-xs text-destructive">Automation summary unavailable</p>
    );
  }
  return (
    <div className="text-xs text-muted-foreground">
      <p>{value.count} Automations</p>
      {value.status === "partial" ? (
        <p>Some Automation sources unavailable</p>
      ) : null}
    </div>
  );
}

function RunsSummary({ value }: { value: RepositorySummaryValue }) {
  if (value.status === "error") {
    return <p className="text-xs text-destructive">Run summary unavailable</p>;
  }
  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {value.hasMore ? `${value.count}+ recent Runs` : `${value.count} Runs`}
      </p>
      {value.status === "partial" ? <p>Some Run sources unavailable</p> : null}
    </div>
  );
}

function DestinationLink({
  href,
  label,
  children,
  external = false,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={external ? `${label} (opens in a new tab)` : label}
    >
      <div className="min-w-0">{children}</div>
      <ExternalLink
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

export function RepositoryDashboardAccessError({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <section
          role="alert"
          className="rounded-md border border-destructive/30 p-6"
        >
          <h1 className="text-balance text-xl font-semibold">
            Repository access could not be verified
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Access to {owner}/{repo} could not be checked. Return to
            Repositories and try again.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/repos">Back to Repositories</Link>
          </Button>
        </section>
      </div>
    </main>
  );
}

export function RepositoryDashboardView({
  owner,
  repo,
  summary,
}: {
  owner: string;
  repo: string;
  summary: RepositoryDashboardSummary;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <header className="border-b border-border pb-4">
          <Link
            href="/repos"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Repositories
          </Link>
          <h1 className="mt-2 break-words font-mono text-2xl font-semibold">
            {owner}/{repo}
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Repository context for Sessions, Automations, and Runs.
          </p>
        </header>

        <nav aria-label="Repository destinations">
          <ul className="grid gap-3 sm:grid-cols-2">
            <li>
              <RepositoryNewSessionAction owner={owner} repo={repo} />
            </li>
            <li>
              <DestinationLink
                href={repositoryAutomationsUrl(owner, repo)}
                label={`Open Automations for ${owner}/${repo}`}
              >
                <p className="font-medium">Automations</p>
                <AutomationSummary value={summary.automations} />
              </DestinationLink>
            </li>
            <li>
              <DestinationLink
                href={repositoryRunsUrl(owner, repo)}
                label={`Open Runs for ${owner}/${repo}`}
              >
                <p className="font-medium">Runs</p>
                <RunsSummary value={summary.runs} />
              </DestinationLink>
            </li>
            <li>
              <DestinationLink
                href={githubRepositoryUrl(owner, repo)}
                label={`Open ${owner}/${repo} on GitHub`}
                external
              >
                <p className="flex items-center gap-2 font-medium">
                  <Github className="size-4" aria-hidden="true" />
                  GitHub
                </p>
                <p className="text-xs text-muted-foreground">
                  Pull requests, issues, and repository administration
                </p>
              </DestinationLink>
            </li>
          </ul>
        </nav>

        <Button asChild variant="ghost" size="sm">
          <Link href={repositorySettingsUrl(owner, repo)}>
            <Settings className="size-4" aria-hidden="true" />
            Repository settings
          </Link>
        </Button>
      </div>
    </main>
  );
}
