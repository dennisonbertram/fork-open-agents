import type { Metadata } from "next";
import { Clock3, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listBackgroundAgentRuns,
  listRepoBackgroundAgents,
} from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { cn } from "@/lib/utils";
import type { BackgroundAgentRun } from "@/lib/db/schema";
import { RepoAgentsDashboard } from "./repo-agents-dashboard";
import { AgentCard } from "./agent-card";

type RepoAgentsPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export const metadata: Metadata = {
  title: "Repo agents",
  description: "Background agent runs for a repository.",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "succeeded" || status === "enabled"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : status === "running" || status === "queued"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function findLatestRunForAgent(
  agentId: string,
  runs: BackgroundAgentRun[],
): BackgroundAgentRun | null {
  return runs.find((r) => r.agentId === agentId) ?? null;
}

export default async function RepoAgentsPage({ params }: RepoAgentsPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;
  const [agents, runs] = await Promise.all([
    listRepoBackgroundAgents({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
    }),
    listBackgroundAgentRuns({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
      limit: 50,
    }),
  ]);

  // Slice runs to 5 for the "Recent runs" peek
  const recentRuns = runs.slice(0, 5);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Background agents</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RepoAgentsDashboard owner={owner} repo={repo} />
            <Link
              href="/settings/background-agents"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Agent prerequisites →
            </Link>
          </div>
        </div>

        {/* Configured agents — operational cards */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Configured agents</h2>
          </div>
          {agents.length === 0 ? (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              No agents configured for this repository.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {agents.map((agent) => {
                const latestRun = findLatestRunForAgent(agent.id, runs);
                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    latestRun={latestRun}
                    owner={owner}
                    repo={repo}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Recent runs — compact peek (up to 5) */}
        <section className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Recent runs</h2>
            {runs.length > 5 && (
              <span className="text-xs text-muted-foreground">
                Showing latest 5 · open an agent for its full history
              </span>
            )}
          </div>
          {recentRuns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No runs recorded for this repository.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/background-runs/${run.id}`}
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="truncate font-mono text-xs">
                        {run.triggerKind}
                      </p>
                      <StatusPill status={run.status} />
                    </div>
                    <p className="mt-1 truncate text-sm">
                      {run.payloadSummary.title ??
                        run.payloadSummary.message ??
                        run.externalId}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {run.sha ?? run.ref ?? run.branch ?? "no ref"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(run.createdAt)}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
