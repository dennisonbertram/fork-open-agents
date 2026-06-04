import type { Metadata } from "next";
import { Clock3, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getOwnedBackgroundAgentWithTriggers,
  listBackgroundAgentRuns,
} from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { cn } from "@/lib/utils";
import type { RunSummary } from "@/lib/background-agents/run-summary";

// ---- Types ------------------------------------------------------------------

type AgentDetailPageProps = {
  params: Promise<{ owner: string; repo: string; agentId: string }>;
};

// ---- Helpers ----------------------------------------------------------------

function StatusPill({ status }: { status: string }) {
  const label = status === "disabled" ? "Paused" : status;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "enabled"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
      )}
    >
      {label}
    </span>
  );
}

function RunStatusPill({ status }: { status: string }) {
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

function formatDate(value: Date | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    year: "numeric",
  }).format(value instanceof Date ? value : new Date(value));
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <h2 className="text-sm font-medium">{children}</h2>
    </div>
  );
}

// ---- Page -------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Agent detail",
  description: "Background agent configuration and run history.",
};

export default async function AgentDetailPage({
  params,
}: AgentDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo, agentId } = await params;

  const [agent, runs] = await Promise.all([
    getOwnedBackgroundAgentWithTriggers({
      userId: session.user.id,
      agentId,
    }),
    listBackgroundAgentRuns({
      userId: session.user.id,
      repoOwner: owner,
      repoName: repo,
      limit: 20,
    }),
  ]);

  if (!agent) {
    redirect(`/repos/${owner}/${repo}/agents`);
  }

  // Filter runs for this specific agent
  const agentRuns = runs.filter((r) => r.agentId === agentId);

  // Derive permissions display
  const permEntries = Object.entries(agent.permissions?.github ?? {});

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* Breadcrumb / header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/repos/${owner}/${repo}/agents`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {owner}/{repo} agents
              </Link>
              <span className="text-muted-foreground">/</span>
              <h1 className="text-sm font-semibold">{agent.name}</h1>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h2 className="text-2xl font-semibold">{agent.name}</h2>
              <StatusPill status={agent.status} />
            </div>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {owner}/{repo}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/repos/${owner}/${repo}/agents`}>
              ← Back to agents
            </Link>
          </Button>
        </div>

        {/* Current state */}
        <section className="rounded-md border border-border">
          <SectionHeader>Current state</SectionHeader>
          <div className="px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <p className="mt-1 text-sm">
                  {agent.status === "disabled" ? "Paused" : "Enabled"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Output mode
                </p>
                <p className="mt-1 text-sm">{agent.outputMode ?? "none"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1 text-sm">{formatDate(agent.updatedAt)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Instructions / purpose */}
        <section className="rounded-md border border-border">
          <SectionHeader>Instructions</SectionHeader>
          <div className="px-4 py-4">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {agent.instructions}
            </pre>
          </div>
        </section>

        {/* Triggers */}
        <section className="rounded-md border border-border">
          <SectionHeader>Trigger</SectionHeader>
          {agent.triggers.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No triggers configured.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agent.triggers.map((trigger) => (
                <div key={trigger.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {trigger.kind}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {trigger.name}
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-4 items-center rounded-full border px-1 text-[9px] font-medium",
                        trigger.status === "enabled"
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-border bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {trigger.status}
                    </span>
                  </div>
                  {trigger.schedule && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Schedule: {trigger.schedule}
                    </p>
                  )}
                  {trigger.lastRunAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last run: {formatDate(trigger.lastRunAt)}
                    </p>
                  )}
                  {trigger.nextRunAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next run: {formatDate(trigger.nextRunAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Permissions */}
        <section className="rounded-md border border-border">
          <SectionHeader>Permissions</SectionHeader>
          <div className="px-4 py-4">
            {permEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No explicit permissions configured.
              </p>
            ) : (
              <div className="grid gap-1">
                {permEntries.map(([perm, level]) => (
                  <div key={perm} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {perm}
                    </span>
                    <span className="rounded border border-border bg-muted/20 px-1 py-0.5 text-[10px]">
                      {String(level)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recent runs */}
        <section className="rounded-md border border-border">
          <SectionHeader>Recent runs</SectionHeader>
          {agentRuns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No runs recorded for this agent.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agentRuns.map((run) => {
                const summary = run.resultSummary as
                  | RunSummary
                  | null
                  | undefined;
                const artifacts = summary?.artifacts ?? [];

                return (
                  <div key={run.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-xs text-muted-foreground">
                            {run.triggerKind}
                          </span>
                          <RunStatusPill status={run.status} />
                        </div>

                        {/* Summary headline (not a chat message — structured summary) */}
                        {summary?.headline && (
                          <p className="mt-2 text-sm font-medium">
                            {summary.headline}
                          </p>
                        )}

                        {/* Blocked reasons */}
                        {(summary?.blocked ?? []).length > 0 && (
                          <div className="mt-2">
                            {summary!.blocked.map((b, i) => (
                              <p
                                key={i}
                                className="text-xs text-red-600 dark:text-red-400"
                              >
                                {b}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Artifacts */}
                        {artifacts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {artifacts.map((artifact, i) => (
                              <div key={i}>
                                {artifact.url ? (
                                  <a
                                    href={artifact.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 rounded border border-border bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                                  >
                                    {artifact.label}
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                ) : (
                                  <span className="rounded border border-border bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground">
                                    {artifact.label}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="mt-2 text-xs text-muted-foreground">
                          {formatDate(run.createdAt)}
                        </p>
                      </div>

                      {/* Link to raw run timeline (evidence/debug) */}
                      <Link
                        href={`/background-runs/${run.id}`}
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="flex items-center gap-1">
                          Run timeline
                          <ExternalLink className="h-3 w-3" />
                        </span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
