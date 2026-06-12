"use client";

import { ArrowLeft, Clock3, Copy } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type { AgentLoopStepRun, AgentLoopEvent } from "@/lib/db/schema";
import { useLoopRunPolling } from "./use-loop-run-polling";
import { RunActions } from "./run-actions";

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
            : status === "running" || status === "queued"
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
}: {
  step: AgentLoopStepRun;
  isActive: boolean;
}) {
  return (
    <div className={cn("grid gap-2 px-4 py-3", isActive && "bg-amber-500/5")}>
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

// ── Main component ─────────────────────────────────────────────────────────────

export function RunDetail({
  initialData,
}: {
  initialData: GetAgentLoopRunDetailResponse;
}) {
  const { data, error } = useLoopRunPolling(initialData.run.id, initialData);
  const detail = data ?? initialData;
  const { run, loop, steps, events } = detail;

  const isActive =
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "paused";

  const guardrails = loop.guardrails as
    | Record<string, unknown>
    | null
    | undefined;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <Link
              href={`/loops/${loop.id}`}
              className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              {loop.name}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">Loop run</h1>
              <StatusPill status={run.status} />
            </div>
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
        <RunActions runId={run.id} loopId={loop.id} status={run.status} />

        {/* Error banner */}
        {run.errorKind && (
          <div className="rounded-md border border-red-500/25 bg-red-500/10 p-3">
            <p className="font-mono text-xs text-red-700 dark:text-red-300">
              {run.errorKind}
            </p>
            {run.errorMessage && (
              <p className="mt-1 text-xs text-muted-foreground">
                {run.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Step timeline */}
        <section className="rounded-md border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Step timeline</h2>
            {isActive && (
              <span className="text-xs text-muted-foreground">Live</span>
            )}
          </div>
          <div aria-live="polite" aria-label="Active step status">
            {steps.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No steps recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {steps.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    isActive={step.id === run.currentStepRunId}
                  />
                ))}
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
