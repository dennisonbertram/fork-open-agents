"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock3, Copy } from "lucide-react";
import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { cn } from "@/lib/utils";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type {
  AgentLoopEvent,
  AgentLoopStepRun,
  AgentLoopWatchdogRun,
} from "@/lib/db/schema";
import { loopDefinitionSchema } from "@/lib/agent-loops/types";
import { getLoopErrorCopy, sanitizeErrorDetail } from "@/app/loops/error-copy";
import { getRunCompletionLabel } from "../../run-completion-label";
import { loopRunsListSwrKey, useLoopRunPolling } from "./use-loop-run-polling";
import { RunActions } from "./run-actions";
import { RunGraph } from "./run-graph";
import { PausedDiagnosisBanner } from "./paused-diagnosis-banner";
import { WatchdogRow } from "./watchdog-row";
import { ComposioWarningsSection } from "./composio-warnings-section";
import { deriveLoopComposioWarnings } from "./composio-warnings";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
  return formatDurationMs(ms);
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "succeeded" || status === "completed"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : status === "running" ||
                status === "queued" ||
                status === "stalled"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

// ── Proof strip item ──────────────────────────────────────────────────────────

function ProofItem({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-1">
        <p className="truncate font-mono text-xs">{value}</p>
        {copyable && (
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(value)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({
  step,
  isActive,
  isHighlighted,
}: {
  step: AgentLoopStepRun;
  isActive: boolean;
  isHighlighted?: boolean;
}) {
  return (
    <div
      id={`step-node-${step.nodeId}`}
      className={cn(
        "grid gap-2 px-4 py-3",
        isActive && "bg-amber-500/5",
        isHighlighted && "bg-violet-500/5 ring-1 ring-inset ring-violet-500/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{step.nodeId}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {step.nodeKind}
          </p>
        </div>
        <StatusPill status={step.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>attempt {step.attempt}</span>
        <span>·</span>
        <Clock3 className="h-3 w-3" />
        <span>{formatDate(step.startedAt)}</span>
        <span>·</span>
        <span>
          {step.durationMs !== null
            ? formatDurationMs(step.durationMs)
            : formatDuration(step.startedAt, step.finishedAt)}
        </span>
        {step.sandboxName && (
          <>
            <span>·</span>
            <span className="font-mono">{step.sandboxName}</span>
          </>
        )}
        {step.errorKind && (
          <>
            <span>·</span>
            <span className="font-mono text-red-600 dark:text-red-400">
              {step.errorKind}
            </span>
          </>
        )}
      </div>
      {step.stepOutput && (
        <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">
            Output
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
            {JSON.stringify(step.stepOutput, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: AgentLoopEvent }) {
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {event.summary ?? event.eventName}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {event.eventName}
          </p>
        </div>
        <StatusPill status={event.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-medium">{event.level}</span>
        <Clock3 className="h-3 w-3" />
        <span>{formatDate(event.createdAt)}</span>
        {event.workflowRunId && (
          <span className="font-mono">workflow {event.workflowRunId}</span>
        )}
        {event.requestId && (
          <span className="font-mono">req {event.requestId}</span>
        )}
        <span className="font-mono">redaction {event.redactionStatus}</span>
      </div>
    </div>
  );
}

// ── Timeline interleave ───────────────────────────────────────────────────────

type TimelineEntry =
  | { kind: "step"; step: AgentLoopStepRun; ts: number }
  | { kind: "watchdog"; watchdogRun: AgentLoopWatchdogRun; ts: number };

/**
 * Merge steps and watchdog runs into a single list ordered by createdAt.
 * Steps use startedAt (fallback: createdAt); watchdog rows use createdAt.
 */
function buildInterleavedTimeline(
  steps: AgentLoopStepRun[],
  watchdogRuns: AgentLoopWatchdogRun[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...steps.map((step) => ({
      kind: "step" as const,
      step,
      ts: new Date(step.startedAt ?? step.createdAt).getTime(),
    })),
    ...watchdogRuns.map((wd) => ({
      kind: "watchdog" as const,
      watchdogRun: wd,
      ts: new Date(wd.createdAt).getTime(),
    })),
  ];
  return entries.sort((a, b) => a.ts - b.ts);
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RunDetail({
  initialData,
}: {
  initialData: GetAgentLoopRunDetailResponse;
}) {
  const { data, error } = useLoopRunPolling(initialData.run.id, initialData);
  const detail = data ?? initialData;
  const { run, loop, steps, events, watchdogRuns } = detail;

  // #798: Composio degradation warnings, derived from events (loops have no
  // persisted RunSummary equivalent to background-agent runs).
  const composioWarnings = deriveLoopComposioWarnings(events);

  const isActive =
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "paused";

  // Completed-with-failures honesty (#767): a "completed" run can still have
  // failed step runs (e.g. a failure-tolerant chain reached END anyway).
  // Computed from `steps` (already fetched for the timeline) — no extra
  // request needed.
  const failedStepCount = steps.filter((s) => s.status === "failed").length;
  const completionLabel = getRunCompletionLabel({
    status: run.status,
    failedStepCount,
  });

  const guardrails = loop.guardrails as
    | Record<string, unknown>
    | null
    | undefined;

  // Graph: parse definitionSnapshot safely; collapse by default on small viewports
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // SNAPSHOT RULE: parse snapshot from the run, never from loop.definition
  const definitionSnapshotResult = loopDefinitionSchema.safeParse(
    run.definitionSnapshot,
  );
  const definitionSnapshot = definitionSnapshotResult.success
    ? definitionSnapshotResult.data
    : null;

  // Node click → scroll timeline to first step for that node and highlight
  function handleNodeClick(nodeId: string) {
    setFocusedNodeId((prev) => (prev === nodeId ? null : nodeId));
    // Scroll to the first step anchor for this node
    const anchor = document.querySelector(`#step-node-${CSS.escape(nodeId)}`);
    if (anchor) {
      anchor.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Link
                href={`/loops/${loop.id}`}
                className="min-w-0 truncate text-muted-foreground hover:text-foreground"
              >
                {loop.name}
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-medium">Run</span>
            </nav>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">Loop run</h1>
              <StatusPill status={run.status} />
            </div>
            {completionLabel ? (
              <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-300">
                {completionLabel}
              </p>
            ) : (
              run.status === "stalled" && (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  No activity for a while — the run appears stuck. Retry it or
                  check the step log.
                </p>
              )
            )}
            <p className="mt-1 truncate font-mono text-sm text-muted-foreground">
              {run.id}
            </p>
            {error && (
              <p className="mt-2 text-xs text-destructive">
                Live refresh failed. Last known state is shown.
              </p>
            )}
          </div>
          {isActive && (
            <span className="text-xs text-muted-foreground">
              Refreshing every 2s
            </span>
          )}
        </div>

        {/* Proof strip */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <ProofItem label="Status" value={run.status} />
          <ProofItem label="Source" value={run.source} />
          <ProofItem
            label="Repository"
            value={`${loop.repoOwner}/${loop.repoName}`}
          />
          <ProofItem
            label="Iterations"
            value={`${run.iterationCount}${guardrails?.maxIterations ? ` / ${guardrails.maxIterations}` : ""}`}
          />
          <ProofItem
            label="Steps"
            value={`${run.stepCount}${guardrails?.maxStepsPerRun ? ` / ${guardrails.maxStepsPerRun}` : ""}`}
          />
          <ProofItem
            label="Duration"
            value={formatDuration(run.startedAt, run.finishedAt)}
          />
          {run.workflowRunId && (
            <ProofItem
              label="Workflow Run"
              value={run.workflowRunId}
              copyable
            />
          )}
          {run.requestId && (
            <ProofItem label="Request ID" value={run.requestId} copyable />
          )}
          {run.currentNodeId && (
            <ProofItem label="Current Node" value={run.currentNodeId} />
          )}
        </section>

        {/* Run actions */}
        <RunActions
          runId={run.id}
          loopId={loop.id}
          status={run.status}
          onActionComplete={() => {
            // Revalidate this run's own SWR key AND the loop's runs-list
            // key (loop-detail.tsx) so the two surfaces can't disagree about
            // this run's status after a control action (#767, walk-3).
            void globalMutate(`/api/agent-loop-runs/${run.id}`);
            void globalMutate(loopRunsListSwrKey(loop.id));
          }}
        />

        {/* Watchdog diagnosis banner — only when paused with a watchdog decision */}
        {run.status === "paused" && watchdogRuns.length > 0 && (
          <PausedDiagnosisBanner watchdogRuns={watchdogRuns} />
        )}

        {/* Error banner — what happened / what to do / technical details (#767) */}
        {run.errorKind &&
          (() => {
            const copy = getLoopErrorCopy(run.errorKind);
            return (
              <div className="rounded-md border border-red-500/25 bg-red-500/10 p-3">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  {copy.whatHappened}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {copy.actionHref ? (
                    <Link href={copy.actionHref} className="underline">
                      {copy.whatToDo}
                    </Link>
                  ) : (
                    copy.whatToDo
                  )}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-muted-foreground">
                    Technical details
                  </summary>
                  <div className="mt-1 space-y-1">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {copy.rawKind}
                    </p>
                    {run.errorMessage && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {sanitizeErrorDetail(run.errorMessage)}
                      </p>
                    )}
                  </div>
                </details>
              </div>
            );
          })()}

        {/* Composio degradation warnings (#798) — distinct from the error
            banner above: shown independent of run.status, so a succeeded
            run whose Composio tools were silently off/disconnected/errored
            still surfaces evidence here. */}
        <ComposioWarningsSection warnings={composioWarnings} />

        {/* Live run graph — ABOVE timeline; collapsible */}
        {definitionSnapshot && definitionSnapshot.nodes.length > 0 && (
          <section className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setGraphCollapsed((c) => !c)}
              className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted/20"
            >
              <h2 className="text-sm font-medium">Run graph</h2>
              <div className="flex items-center gap-2">
                {isActive && (
                  <span className="text-xs text-muted-foreground">Live</span>
                )}
                {graphCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
            {!graphCollapsed && (
              <div className="h-72 sm:h-96">
                <RunGraph
                  definitionSnapshot={definitionSnapshot}
                  steps={steps}
                  run={run}
                  guardrails={guardrails ?? null}
                  events={events}
                  onNodeClick={handleNodeClick}
                />
              </div>
            )}
          </section>
        )}

        {/* Step timeline */}
        <section className="rounded-md border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Step timeline</h2>
            {focusedNodeId && (
              <button
                type="button"
                onClick={() => setFocusedNodeId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear filter
              </button>
            )}
            {isActive && !focusedNodeId && (
              <span className="text-xs text-muted-foreground">Live</span>
            )}
          </div>
          <div aria-live="polite" aria-label="Active step status">
            {steps.length === 0 && watchdogRuns.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No steps recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {buildInterleavedTimeline(steps, watchdogRuns).map((entry) =>
                  entry.kind === "step" ? (
                    <StepRow
                      key={`step-${entry.step.id}`}
                      step={entry.step}
                      isActive={entry.step.id === run.currentStepRunId}
                      isHighlighted={
                        focusedNodeId !== null &&
                        entry.step.nodeId === focusedNodeId
                      }
                    />
                  ) : (
                    <WatchdogRow
                      key={`watchdog-${entry.watchdogRun.id}`}
                      watchdogRun={entry.watchdogRun}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </section>

        {/* Event log */}
        <section className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Event log</h2>
          </div>
          {events.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No events recorded.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>

        {/* Debug sidebar */}
        <section className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Correlation IDs</h2>
          </div>
          <div className="divide-y divide-border text-sm">
            {[
              { label: "Loop Run ID", value: run.id },
              { label: "Loop ID", value: run.loopId },
              { label: "Workflow Run ID", value: run.workflowRunId },
              { label: "Request ID", value: run.requestId },
              { label: "Idempotency Key", value: run.idempotencyKey },
            ].map(({ label, value }) => (
              <div key={label} className="grid gap-1 px-4 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="break-all font-mono text-xs">
                  {value ?? "-"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
