"use client";

import { ArrowLeft, Play, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  GetAgentLoopResponse,
  ListAgentLoopRunsResponse,
  StartAgentLoopRunResponse,
} from "@/app/api/agent-loops/types";
import type { AgentLoopRun } from "@/lib/db/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Request failed");
  }
  return res.json() as Promise<T>;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(
  startedAt: Date | string | null,
  finishedAt: Date | string | null,
): string {
  if (!startedAt) return "-";
  if (!finishedAt) return "Running";
  const ms = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "active" || status === "succeeded" || status === "completed"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed" || status === "cancelled"
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

// ── Run row ───────────────────────────────────────────────────────────────────

function RunRow({ run, loopId }: { run: AgentLoopRun; loopId: string }) {
  return (
    <Link
      href={`/loops/${loopId}/runs/${run.id}`}
      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{run.id}</p>
      </div>
      <StatusPill status={run.status} />
      <span className="text-xs text-muted-foreground">{run.source}</span>
      <div className="text-right">
        <p className="text-xs">{formatDate(run.createdAt)}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatDuration(run.startedAt, run.finishedAt)}
        </p>
      </div>
    </Link>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type LoopDetailProps = {
  loopId: string;
  initialLoopData: GetAgentLoopResponse;
};

export function LoopDetail({ loopId, initialLoopData }: LoopDetailProps) {
  const router = useRouter();
  const [runningNow, setRunningNow] = useState(false);
  const [activeRunNotice, setActiveRunNotice] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const { data: loopData, mutate: mutateLoopData } =
    useSWR<GetAgentLoopResponse>(`/api/agent-loops/${loopId}`, fetchJson, {
      fallbackData: initialLoopData,
    });
  const { data: runsData } = useSWR<ListAgentLoopRunsResponse>(
    `/api/agent-loops/${loopId}/runs`,
    fetchJson,
    { refreshInterval: 5000 },
  );

  const { loop, triggers } = loopData ?? initialLoopData;
  const runs = runsData?.runs ?? [];

  async function handleRunNow() {
    setRunningNow(true);
    setActiveRunNotice(null);
    try {
      const res = await fetch(`/api/agent-loops/${loopId}/runs`, {
        method: "POST",
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          errorKind?: string;
          message?: string;
          activeRunId?: string;
        };
        if (body.errorKind === "active_run") {
          // Surface a non-destructive notice instead of an error toast.
          // The API returns activeRunId when available (includes paused runs).
          // Fall back to searching the local runs list for running, queued,
          // OR paused runs — hasActiveRunForLoop counts all three.
          const activeId =
            body.activeRunId ??
            runs.find(
              (r) =>
                r.status === "running" ||
                r.status === "queued" ||
                r.status === "paused",
            )?.id;
          setActiveRunNotice(activeId ?? "unknown");
          return;
        }
        toast.error(body.message ?? "Cannot start run right now.");
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(body.message ?? "Failed to start run.");
        return;
      }

      const { runId } = (await res.json()) as StartAgentLoopRunResponse;
      toast.success("Run started");
      router.push(`/loops/${loopId}/runs/${runId}`);
    } catch {
      toast.error("Failed to start run.");
    } finally {
      setRunningNow(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/agent-loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(body.message ?? "Failed to update loop status.");
      } else {
        const body = (await res.json().catch(() => null)) as {
          loop?: GetAgentLoopResponse["loop"];
        } | null;
        if (body?.loop) {
          await mutateLoopData(
            (current) => (current ? { ...current, loop: body.loop! } : current),
            false,
          );
        } else {
          // Revalidate from server if response body is unavailable
          await mutateLoopData();
        }
        toast.success(`Loop status updated to ${newStatus}`);
      }
    } catch {
      toast.error("Failed to update loop status.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <Link
              href={`/repos/${loop.repoOwner}/${loop.repoName}/loops`}
              className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {loop.repoOwner}/{loop.repoName}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">{loop.name}</h1>
              <StatusPill status={loop.status} />
            </div>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {loop.repoOwner}/{loop.repoName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/loops/${loopId}/builder`}>
              <Button variant="outline" size="sm">
                <Workflow className="mr-2 h-4 w-4" />
                Open builder
              </Button>
            </Link>
            <Button
              onClick={handleRunNow}
              disabled={runningNow || loop.status !== "active"}
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              {runningNow ? "Starting…" : "Run now"}
            </Button>
          </div>
        </div>

        {/* Active run notice (409) */}
        {activeRunNotice && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            This loop already has an active or paused run:{" "}
            <Link
              href={`/loops/${loopId}/runs/${activeRunNotice}`}
              className="font-mono underline"
            >
              {activeRunNotice}
            </Link>
            . Wait for it to complete, resume, or cancel it before starting a
            new run.
          </div>
        )}

        {/* Loop not active notice */}
        {loop.status !== "active" && (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            Loop must be in <span className="font-mono">active</span> status to
            run manually.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Run history */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Run history</h2>
              </div>
              {runs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No runs yet. Click &ldquo;Run now&rdquo; to start the first
                  run.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {runs.map((run) => (
                    <RunRow key={run.id} run={run} loopId={loopId} />
                  ))}
                </div>
              )}
            </section>

            {/* Definition */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Definition</h2>
              </div>
              <details className="px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Show JSON definition
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-[11px]">
                  {JSON.stringify(loop.definition, null, 2)}
                </pre>
              </details>
            </section>
          </div>

          <aside className="space-y-6">
            {/* Status control */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Loop status</h2>
              </div>
              <div className="p-4">
                <Select
                  value={loop.status}
                  onValueChange={handleStatusChange}
                  disabled={updatingStatus}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            {/* Trigger summary */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Triggers</h2>
              </div>
              {triggers.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  No triggers configured. Manage triggers in{" "}
                  <Link
                    href="/settings/background-agents"
                    className="underline hover:text-foreground"
                  >
                    Background agents settings
                  </Link>
                  .
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {triggers.map((trigger) => (
                    <div key={trigger.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs">{trigger.kind}</p>
                        <StatusPill status={trigger.status} />
                      </div>
                      {trigger.schedule && (
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {trigger.schedule}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Guardrails */}
            {loop.guardrails && (
              <section className="rounded-md border border-border">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-medium">Guardrails</h2>
                </div>
                <div className="divide-y divide-border text-sm">
                  {Object.entries(loop.guardrails).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-3 px-4 py-2"
                    >
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-mono text-xs">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
