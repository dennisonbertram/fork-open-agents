import { ArrowRight, Github, Lock, RefreshCw } from "lucide-react";
import Link from "next/link";
import type {
  RepositoryDirectoryItem,
  RepositoryDirectorySnapshot,
} from "@/lib/github/repository-directory";
import { repositoryDashboardUrl } from "@/lib/repositories/routes";
import { Button } from "@/components/ui/button";

function connectGitHubUrl(): string {
  const params = new URLSearchParams({ next: "/repos" });
  return `/api/github/app/install?${params.toString()}`;
}

function DirectoryMessage({
  snapshot,
}: {
  snapshot: RepositoryDirectorySnapshot;
}) {
  if (snapshot.status === "github_not_connected") {
    return (
      <section className="rounded-md border border-border p-6">
        <h2 className="text-balance text-lg font-medium">Connect GitHub</h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Connect your GitHub account to list repositories available through
          your GitHub App installations.
        </p>
        <Button asChild className="mt-4">
          <Link href={connectGitHubUrl()}>
            <Github className="size-4" aria-hidden="true" />
            Connect GitHub
          </Link>
        </Button>
      </section>
    );
  }

  if (snapshot.status === "installation_required") {
    return (
      <section className="rounded-md border border-border p-6">
        <h2 className="text-balance text-lg font-medium">
          Install the GitHub App
        </h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Your account is connected, but no GitHub App installation grants
          repository access yet.
        </p>
        <Button asChild className="mt-4">
          <Link href={connectGitHubUrl()}>Choose repository access</Link>
        </Button>
      </section>
    );
  }

  if (snapshot.status === "empty") {
    return (
      <section className="rounded-md border border-border p-6">
        <h2 className="text-balance text-lg font-medium">
          No accessible repositories
        </h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Update your GitHub App installation to grant access to at least one
          repository.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/settings/connections">Manage GitHub access</Link>
        </Button>
      </section>
    );
  }

  if (snapshot.status === "error") {
    return (
      <section
        role="alert"
        className="rounded-md border border-destructive/30 p-6"
      >
        <h2 className="text-balance text-lg font-medium">
          Repositories could not be loaded
        </h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          GitHub access could not be verified. Try again, then review your
          connection if the problem continues. Request {snapshot.requestId}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/repos">
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings/connections">Settings → Connections</Link>
          </Button>
        </div>
      </section>
    );
  }

  if (snapshot.status === "partial") {
    return (
      <section className="rounded-md border border-border p-6">
        <h2 className="text-balance text-lg font-medium">
          No repositories returned by available installations
        </h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">
          Some GitHub installations could not be checked. Review access before
          treating this as an empty repository list.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/settings/connections">Manage GitHub access</Link>
        </Button>
      </section>
    );
  }

  return null;
}

function RepositoryRow({
  repository,
}: {
  repository: RepositoryDirectoryItem;
}) {
  const href = repositoryDashboardUrl(repository.owner, repository.name);
  return (
    <li className="min-w-0 rounded-md border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {repository.private ? (
              <Lock
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Private repository"
              />
            ) : null}
            <h2 className="truncate font-mono text-sm font-medium">
              {repository.fullName}
            </h2>
          </div>
          {repository.description ? (
            <p className="mt-1 line-clamp-2 text-pretty text-sm text-muted-foreground">
              {repository.description}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            {repository.language ?? "Language not reported"}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open {repository.fullName}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function RepositoryDirectoryView({
  snapshot,
}: {
  snapshot: RepositoryDirectorySnapshot;
}) {
  const showsRepositories =
    (snapshot.status === "ready" || snapshot.status === "partial") &&
    snapshot.repositories.length > 0;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header>
          <h1 className="text-balance text-2xl font-semibold">Repositories</h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Choose a repository context for Sessions, Automations, and Runs.
          </p>
        </header>

        {snapshot.status === "partial" ? (
          <div
            role="alert"
            className="rounded-md border border-amber-500/30 p-4 text-sm"
          >
            <p className="font-medium">
              Some GitHub installations could not be loaded
            </p>
            <p className="mt-1 text-pretty text-muted-foreground">
              Showing repositories from the installations that responded.
              Request {snapshot.requestId}.
            </p>
          </div>
        ) : null}

        {showsRepositories ? (
          <ul aria-label="Accessible repositories" className="grid gap-3">
            {snapshot.repositories.map((repository) => (
              <RepositoryRow
                key={`${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`}
                repository={repository}
              />
            ))}
          </ul>
        ) : (
          <DirectoryMessage snapshot={snapshot} />
        )}
      </div>
    </main>
  );
}
