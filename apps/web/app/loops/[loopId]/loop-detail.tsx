"use client";

import { ChevronRight, Play, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ReadinessVerdict,
  type ReadinessVerdictProps,
} from "@/components/ui/readiness-verdict";
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
  AgentLoopsReadinessResponse,
} from "@/app/api/agent-loops/types";
import type { AgentLoopRun } from "@/lib/db/schema";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { ListLoopTriggersResponse } from "@/app/api/agent-loops/[loopId]/triggers/trigger-route-types";
import { summarizeLoopSteps } from "./loop-step-summary";
import { getStatusMeaning } from "./status-meanings";
import { getActiveStatusNote } from "./status-trigger-notice";
import { LoopTriggersCard } from "./loop-triggers-card";
import { StatusPill } from "./status-pill";
import { getGuardrailLabel } from "./guardrail-labels";
import { useLoopRunNow } from "./use-loop-run-now";
import { getScheduleTruthLine } from "./schedule-truth-line";
import { getRunCompletionLabel } from "./run-completion-label";
import { getRunHistoryEmptyState } from "./run-history-empty-state";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import {
  canonicalLoopAutomationDetailUrl,
  canonicalLoopAutomationEditUrl,
} from "@/lib/automations/definition-routes";
import { canonicalRunDetailUrl } from "@/lib/runs/detail-routes";

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

function RunRow({
  run,
  loopId,
  surface,
}: {
  run: AgentLoopRun & { failedStepCount?: number };
  loopId: string;
  surface: "legacy" | "automation";
}) {
  const completionLabel = getRunCompletionLabel({
    status: run.status,
    failedStepCount: run.failedStepCount ?? 0,
  });
  return (
    <Link
      href={
        surface === "automation"
          ? canonicalRunDetailUrl("agent_loop", run.id)
          : `/loops/${loopId}/runs/${run.id}`
      }
      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{run.id}</p>
        {completionLabel && (
          <p className="mt-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {completionLabel}
          </p>
        )}
        {run.status === "stalled" && (
          <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            No activity for a while — the run appears stuck.
          </p>
        )}
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
  surface?: "legacy" | "automation";
};

const MANUAL_EXECUTION_CHECK_IDS = new Set([
  "feature_flag",
  "repo_allowlist",
  "repo_access",
]);

function mapExecutionReadiness(
  readiness: AgentLoopsReadinessResponse | undefined,
  error: unknown,
): ReadinessVerdictProps & { ready: boolean } {
  if (error || !readiness || !Array.isArray(readiness.checks)) {
    return {
      ready: false,
      status: "error",
      headline: "Execution readiness unknown",
      subtext:
        "Readiness could not be verified. Manual execution remains unavailable.",
    };
  }
  const checks = readiness.checks.filter((check) =>
    MANUAL_EXECUTION_CHECK_IDS.has(check.id),
  );
  const complete = MANUAL_EXECUTION_CHECK_IDS.size === checks.length;
  const ready =
    readiness.enabled &&
    complete &&
    checks.every((check) => check.status === "ready");
  return {
    ready,
    status: ready
      ? "ready"
      : readiness.enabled
        ? "action-needed"
        : "unavailable",
    headline: ready
      ? "Ready for manual execution"
      : readiness.enabled
        ? "Execution prerequisites need attention"
        : "Multi-step Automations are disabled",
    subtext: ready
      ? "Deployment and repository gates passed."
      : "Run now remains unavailable until every required check passes.",
    checks,
  };
}

export function LoopDetail({
  loopId,
  initialLoopData,
  surface = "legacy",
}: LoopDetailProps) {
  const automationSurface = surface === "automation";
  const [activeRunNotice, setActiveRunNotice] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const { data: loopData, mutate: mutateLoopData } =
    useSWR<GetAgentLoopResponse>(`/api/agent-loops/${loopId}`, fetchJson, {
      fallbackData: initialLoopData,
    });
  const { data: runsData, mutate: mutateRunsData } =
    useSWR<ListAgentLoopRunsResponse>(
      `/api/agent-loops/${loopId}/runs`,
      fetchJson,
      { refreshInterval: 5000 },
    );
  const { data: triggersData, mutate: mutateTriggersData } =
    useSWR<ListLoopTriggersResponse>(
      `/api/agent-loops/${loopId}/triggers`,
      fetchJson,
    );
  const {
    data: readinessData,
    error: readinessError,
    mutate: mutateReadiness,
    isLoading: readinessLoading,
  } = useSWR<AgentLoopsReadinessResponse>(
    automationSurface
      ? `/api/agent-loops/readiness?owner=${encodeURIComponent(initialLoopData.loop.repoOwner)}&repo=${encodeURIComponent(initialLoopData.loop.repoName)}`
      : null,
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
  const executionReadiness: ReadinessVerdictProps & { ready: boolean } =
    automationSurface
      ? mapExecutionReadiness(readinessData, readinessError)
      : {
          ready: true,
          status: "ready",
          headline: "Ready",
        };
  const configurationValid = validateLoopDefinition(loop.definition).ok;
  const detailHref = automationSurface
    ? canonicalLoopAutomationDetailUrl(loopId)
    : `/loops/${loopId}`;
  const editHref = automationSurface
    ? canonicalLoopAutomationEditUrl(loopId)
    : `${detailHref}/builder`;

  const { runNow: handleRunNow, runningNow } = useLoopRunNow({
    loopId,
    surface,
    onStart: () => setActiveRunNotice(null),
    onActiveRun: (id) => setActiveRunNotice(id),
    resolveActiveRunId: () =>
      runs.find(
        (r) =>
          r.status === "running" ||
          r.status === "queued" ||
          r.status === "paused",
      )?.id,
    onStarted: () => {
      // Revalidate the runs list immediately (#767) so it doesn't disagree
      // with the run-detail page the user is about to land on.
      void mutateRunsData();
    },
  });

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
        toast.success(
          `${automationSurface ? "Automation" : "Loop"} status updated to ${newStatus}`,
        );
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
                href={automationSurface ? "/automations" : "/loops"}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {automationSurface ? "Automations" : "Loops"}
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
            {automationSurface ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Multi-step Automation
              </p>
            ) : null}
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {loop.repoOwner}/{loop.repoName}
            </p>
          </div>
          <div id="loop-run-now" className="flex items-center gap-2">
            <Link href={editHref}>
              <Button variant="outline" size="sm">
                <Workflow className="mr-2 h-4 w-4" />
                {automationSurface ? "Edit Steps" : "Open builder"}
              </Button>
            </Link>
            <Button
              onClick={handleRunNow}
              disabled={
                runningNow ||
                loop.status !== "active" ||
                (automationSurface &&
                  (!executionReadiness.ready || !configurationValid))
              }
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              {runningNow ? "Starting…" : "Run now"}
            </Button>
          </div>
        </div>

        {automationSurface ? (
          <>
            <p className="text-pretty text-xs text-amber-700 dark:text-amber-300">
              Run now starts real unattended work with the configured repository
              permissions.
            </p>
            <section className="rounded-md border border-border p-4">
              <h2 className="text-balance text-sm font-medium">
                Automation status
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <h3 className="text-xs text-muted-foreground">
                    Configuration validity
                  </h3>
                  <p className="mt-1 text-sm font-medium">
                    {configurationValid
                      ? "Valid definition"
                      : "Invalid definition"}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs text-muted-foreground">
                    Lifecycle status
                  </h3>
                  <p className="mt-1 text-sm font-medium capitalize">
                    {loop.status}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs text-muted-foreground">
                    Trigger coverage
                  </h3>
                  <p className="mt-1 text-sm font-medium">
                    {triggers.length === 0
                      ? "No triggers configured"
                      : `${triggers.length} trigger${triggers.length === 1 ? "" : "s"} configured`}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <h3 className="mb-2 text-xs text-muted-foreground">
                  Execution readiness
                </h3>
                <ReadinessVerdict
                  {...executionReadiness}
                  onRefresh={() => void mutateReadiness()}
                  refreshing={readinessLoading}
                />
              </div>
            </section>
          </>
        ) : null}

        {/* Active run notice (409) */}
        {activeRunNotice && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            This {automationSurface ? "Automation" : "loop"} already has an
            active or paused run:{" "}
            <Link
              href={
                automationSurface
                  ? canonicalRunDetailUrl("agent_loop", activeRunNotice)
                  : `/loops/${loopId}/runs/${activeRunNotice}`
              }
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
            {automationSurface ? "Automation" : "Loop"} must be in{" "}
            <span className="font-mono">active</span> status to run manually.
          </div>
        )}

        {/* Stalled-runs summary (#767) — surfaced above the fold so a pile
            of stuck runs can't hide inside the run history list. */}
        {(() => {
          const stalledCount = runs.filter(
            (r) => r.status === "stalled",
          ).length;
          if (stalledCount === 0) return null;
          return (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {stalledCount} stalled run{stalledCount === 1 ? "" : "s"} need
              attention.
            </div>
          );
        })()}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Run history */}
            <section
              id="loop-run-history"
              className="rounded-md border border-border"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Run history</h2>
              </div>
              {runs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {getRunHistoryEmptyState(loop.status)}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {runs.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      loopId={loopId}
                      surface={surface}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Definition — prose step list is the primary description; raw
                JSON moves behind "Advanced" for anyone who needs it. */}
            <section className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">
                  {automationSurface
                    ? "What this Automation does"
                    : "What this loop does"}
                </h2>
              </div>
              <div className="px-4 py-3">
                {(() => {
                  const steps = summarizeLoopSteps(
                    loop.definition as LoopDefinition,
                  );
                  if (steps.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        {automationSurface
                          ? "This Automation has no Steps yet. Edit Steps to add one."
                          : "This loop has no steps yet. Open the builder to add one."}
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
            <section
              id="loop-status-section"
              className="rounded-md border border-border"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">
                  {automationSurface ? "Automation lifecycle" : "Loop status"}
                </h2>
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
                {/* Schedule truth line (#767) — answers "when does this run
                    next?" using the Triggers card's nextRunAt (#762). */}
                <p className="text-xs text-muted-foreground">
                  {getScheduleTruthLine({
                    loopStatus: loop.status,
                    triggers,
                  })}
                </p>
              </div>
            </section>

            {/* Trigger manager (#762) */}
            <div id="loop-triggers-section">
              <LoopTriggersCard
                loopId={loopId}
                loopStatus={loop.status}
                triggers={triggers}
                onTriggersChanged={() => {
                  void mutateTriggersData();
                }}
                surface={surface}
              />
            </div>

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
                      <span className="text-muted-foreground">
                        {getGuardrailLabel(key)}
                      </span>
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
