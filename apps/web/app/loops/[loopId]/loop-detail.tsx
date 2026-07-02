"use client";

import { ChevronRight, Play, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
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
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { ListLoopTriggersResponse } from "@/app/api/agent-loops/[loopId]/triggers/trigger-route-types";
import { summarizeLoopSteps } from "./loop-step-summary";
import { getStatusMeaning } from "./status-meanings";
import { getActiveStatusNote } from "./status-trigger-notice";
import { LoopTriggersCard } from "./loop-triggers-card";
import { StatusPill } from "./status-pill";

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
  const { data: triggersData, mutate: mutateTriggersData } =
    useSWR<ListLoopTriggersResponse>(
      `/api/agent-loops/${loopId}/triggers`,
      fetchJson,
    );

  const { loop } = loopData ?? initialLoopData;
  const runs = runsData?.runs ?? [];
  // triggersData (from the #762 triggers route) carries the humanized
  // schedule + nextRunAt; fall back to the loop-detail page's initial
  // trigger summary (no humanized fields) until the client fetch resolves,
  // so the trigger COUNT used by status-honesty copy is correct on first
  // paint even before triggersData loads.
  const triggers = triggersData?.triggers ?? initialLoopData.triggers;

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

      if (res.status === 502) {
        // Issue #763 — no false success: the execution backend rejected the
        // dispatch. The run was created but is already marked failed —
        // surface the real state and point at the run page for details.
        const body = (await res.json().catch(() => ({}))) as {
          errorKind?: string;
          runId?: string;
        };
        toast.error(
          "Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details.",
        );
        if (body.runId) {
          router.push(`/loops/${loopId}/runs/${body.runId}`);
        }
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
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <nav
              aria-label="Loop breadcrumb"
              className="mb-3 flex min-w-0 items-center gap-1.5 text-sm"
            >
              <Link
                href="/loops"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                Loops
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Link
                href={`/repos/${loop.repoOwner}/${loop.repoName}`}
                className="min-w-0 truncate font-mono text-muted-foreground hover:text-foreground"
              >
                {loop.repoOwner}/{loop.repoName}
              </Link>
            </nav>
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

            {/* Definition — prose step list is the primary description; raw
                JSON moves behind "Advanced" for anyone who needs it. */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">What this loop does</h2>
              </div>
              <div className="px-4 py-3">
                {(() => {
                  const steps = summarizeLoopSteps(
                    loop.definition as LoopDefinition,
                  );
                  if (steps.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        This loop has no steps yet. Open the builder to add one.
                      </p>
                    );
                  }
                  return (
                    <ol className="space-y-1 text-sm text-foreground">
                      {steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  );
                })()}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Advanced — view JSON definition
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-[11px]">
                    {JSON.stringify(loop.definition, null, 2)}
                  </pre>
                </details>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            {/* Status control */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Loop status</h2>
              </div>
              <div className="space-y-2 p-4">
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
                <p className="text-xs text-muted-foreground">
                  {getStatusMeaning(loop.status)}
                </p>
                {(() => {
                  const activeNote = getActiveStatusNote({
                    status: loop.status,
                    triggerCount: triggers.length,
                  });
                  return activeNote ? (
                    <p className="text-xs text-muted-foreground">
                      {activeNote}
                    </p>
                  ) : null;
                })()}
              </div>
            </section>

            {/* Trigger manager (#762) */}
            <LoopTriggersCard
              loopId={loopId}
              loopStatus={loop.status}
              triggers={triggers}
              onTriggersChanged={() => {
                void mutateTriggersData();
              }}
            />

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
