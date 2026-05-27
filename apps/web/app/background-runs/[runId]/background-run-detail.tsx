"use client";

import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { cn } from "@/lib/utils";

type SerializedBackgroundRun = {
  id: string;
  status: string;
  triggerKind: string;
  repoOwner: string;
  repoName: string;
  ref: string | null;
  sha: string | null;
  branch: string | null;
  outputKind: string | null;
  outputUrl: string | null;
  sandboxName: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type SerializedBackgroundEvent = {
  id: string;
  eventName: string;
  status: string;
  summary: string | null;
  workflowRunId: string | null;
  sandboxName: string | null;
  errorKind: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type SerializedBackgroundOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
};

type BackgroundRunDetailData = {
  run: SerializedBackgroundRun;
  events: SerializedBackgroundEvent[];
  outputs: SerializedBackgroundOutput[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load background run");
  }
  return (await response.json()) as T;
}

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

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
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

function stringifyPayloadValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function CommandOutput({ event }: { event: SerializedBackgroundEvent }) {
  const command = stringifyPayloadValue(event.payload.command);
  const stdout = stringifyPayloadValue(event.payload.stdout);
  const stderr = stringifyPayloadValue(event.payload.stderr);
  const durationMs = stringifyPayloadValue(event.payload.durationMs);

  if (!(command || stdout || stderr || durationMs)) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
      {command && (
        <p className="truncate font-mono text-muted-foreground">{command}</p>
      )}
      {durationMs && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {durationMs}ms
        </p>
      )}
      {stdout && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-500/5 p-2 font-mono text-[11px] text-red-700 dark:text-red-300">
          {stderr}
        </pre>
      )}
    </div>
  );
}

export function BackgroundRunDetail({
  initialData,
}: {
  initialData: BackgroundRunDetailData;
}) {
  const { data, error } = useSWR<BackgroundRunDetailData>(
    `/api/background-agent-runs/${initialData.run.id}`,
    fetchJson,
    {
      fallbackData: initialData,
      refreshInterval: (latest) =>
        latest?.run.status === "queued" || latest?.run.status === "running"
          ? 2000
          : 0,
    },
  );
  const detail = data ?? initialData;
  const { run, events, outputs } = detail;

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
            {error && (
              <p className="mt-2 text-xs text-destructive">
                Live refresh failed. Existing evidence is still shown.
              </p>
            )}
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
          <ProofItem label="Sandbox" value={run.sandboxName ?? "-"} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">Live timeline</h2>
              {(run.status === "queued" || run.status === "running") && (
                <span className="text-xs text-muted-foreground">
                  Refreshing
                </span>
              )}
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
                    <CommandOutput event={event} />
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <span>{formatDate(event.createdAt)}</span>
                      {event.workflowRunId && (
                        <span className="font-mono">
                          workflow {event.workflowRunId}
                        </span>
                      )}
                      {event.sandboxName && (
                        <span className="font-mono">
                          sandbox {event.sandboxName}
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
                  <span className="text-muted-foreground">Output</span>
                  <span className="font-mono">{run.outputKind ?? "none"}</span>
                </div>
                {run.errorKind && (
                  <div className="grid gap-1 px-4 py-2">
                    <span className="text-muted-foreground">Error</span>
                    <span className="font-mono text-xs">{run.errorKind}</span>
                    {run.errorMessage && (
                      <span className="text-xs text-muted-foreground">
                        {run.errorMessage}
                      </span>
                    )}
                  </div>
                )}
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

export type { BackgroundRunDetailData };
