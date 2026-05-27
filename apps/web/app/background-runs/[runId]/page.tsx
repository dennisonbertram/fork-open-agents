import type { Metadata } from "next";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getOwnedBackgroundAgentRun,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
} from "@/lib/background-agents/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { cn } from "@/lib/utils";

type BackgroundRunPageProps = {
  params: Promise<{ runId: string }>;
};

export const metadata: Metadata = {
  title: "Background run",
  description: "Background agent run evidence.",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "succeeded" || status === "created"
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
    second: "2-digit",
  }).format(value);
}

function ProofItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-xs">{value}</p>
    </div>
  );
}

export default async function BackgroundRunPage({
  params,
}: BackgroundRunPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { runId } = await params;
  const run = await getOwnedBackgroundAgentRun({
    userId: session.user.id,
    runId,
  });
  if (!run) {
    notFound();
  }

  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <Link
              href={`/repos/${run.repoOwner}/${run.repoName}/agents`}
              className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Repo agents
            </Link>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <h1 className="truncate text-2xl font-semibold">
                Background run
              </h1>
              <StatusPill status={run.status} />
            </div>
            <p className="mt-1 truncate font-mono text-sm text-muted-foreground">
              {run.id}
            </p>
          </div>
          {run.outputUrl && (
            <Link
              href={run.outputUrl}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Output
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <ProofItem label="Trigger" value={run.triggerKind} />
          <ProofItem
            label="Repository"
            value={`${run.repoOwner}/${run.repoName}`}
          />
          <ProofItem
            label="Ref"
            value={run.sha ?? run.ref ?? run.branch ?? "-"}
          />
          <ProofItem label="Output" value={run.outputKind ?? "none"} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-md border border-border">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">Timeline</h2>
            </div>
            {events.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No events recorded.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {events.map((event) => (
                  <div key={event.id} className="grid gap-3 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {event.summary ?? event.eventName}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {event.eventName}
                        </p>
                      </div>
                      <StatusPill status={event.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <span>{formatDate(event.createdAt)}</span>
                      {event.workflowRunId && (
                        <span className="font-mono">
                          workflow {event.workflowRunId}
                        </span>
                      )}
                      {event.errorKind && (
                        <span className="font-mono">{event.errorKind}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Run</h2>
              </div>
              <div className="divide-y divide-border text-sm">
                <div className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(run.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-muted-foreground">Started</span>
                  <span>{formatDate(run.startedAt)}</span>
                </div>
                <div className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-muted-foreground">Finished</span>
                  <span>{formatDate(run.finishedAt)}</span>
                </div>
                <div className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-muted-foreground">Sandbox</span>
                  <span className="truncate font-mono">
                    {run.sandboxName ?? "-"}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Outputs</h2>
              </div>
              {outputs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No outputs recorded.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {outputs.map((output) => (
                    <div key={output.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{output.kind}</span>
                        </div>
                        <StatusPill status={output.status} />
                      </div>
                      {output.url && (
                        <Link
                          href={output.url}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
