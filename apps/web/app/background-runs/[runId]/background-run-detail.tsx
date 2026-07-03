"use client";

import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { RunErrorBanner } from "./run-error-banner";
import { RunSummarySection } from "./run-summary-section";
import { useBackgroundRunEventSource } from "./use-background-run-event-source";
import type {
  BackgroundRunDetailData,
  SerializedBackgroundAgent,
  SerializedBackgroundEvent,
  SerializedBackgroundOutput,
  SerializedBackgroundRun,
  StreamStatus,
} from "./types";

function isSseEnabled(): boolean {
  const env = process.env.NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE;
  return env === "1" || env === "true";
}

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

function DebugRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 px-4 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs">{value ?? "-"}</span>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) {
    return "-";
  }
  if (!finishedAt) {
    return "Running";
  }

  const durationMs = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatPermissionSummary(agent: SerializedBackgroundAgent | null) {
  const permissions = isRecord(agent?.permissions) ? agent.permissions : null;
  const github = isRecord(permissions?.github) ? permissions.github : null;
  if (github) {
    const entries: string[] = [];
    for (const key of ["contents", "pullRequests", "issues", "checks"]) {
      const value = stringifyPayloadValue(github[key]);
      if (value) {
        entries.push(`${key}:${value}`);
      }
    }
    if (entries.length > 0) {
      return entries.join(", ");
    }
  }

  return "GitHub read";
}

function getLatestCheckEvent(events: SerializedBackgroundEvent[]) {
  return events.find(
    (event) => event.eventName === "background-agent.check.completed",
  );
}

function formatCheckSummary(
  events: SerializedBackgroundEvent[],
  agent: SerializedBackgroundAgent | null,
) {
  const checkEvent = getLatestCheckEvent(events);
  if (!checkEvent) {
    return agent?.checkCommand?.trim() ? "Pending" : "Not configured";
  }

  const command = stringifyPayloadValue(checkEvent.payload.command);
  return command ? `${checkEvent.status} · ${command}` : checkEvent.status;
}

function formatOutputSummary(outputs: SerializedBackgroundOutput[]) {
  const output = outputs[0];
  if (output) {
    return `${output.kind} · ${output.status}`;
  }
  return "none";
}

/**
 * Sidebar "Run" section's Output field: lists the recorded action outputs
 * (kind per row). "none" when no outputs have been recorded yet.
 */
function formatSidebarOutputKinds(outputs: SerializedBackgroundOutput[]) {
  if (outputs.length === 0) {
    return "none";
  }
  return outputs.map((output) => output.kind).join(", ");
}

function findCostValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes("cost")) {
      const cost = findCostValue(child);
      if (cost !== null) {
        return cost;
      }
    }
    if (isRecord(child)) {
      const nested = findCostValue(child);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function formatRunCost(events: SerializedBackgroundEvent[]) {
  for (const event of events) {
    const cost = findCostValue(event.payload);
    if (cost !== null) {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(cost);
    }
  }
  return null;
}

function formatRunTarget(run: SerializedBackgroundRun) {
  if (run.prNumber !== null) {
    return `PR #${run.prNumber}`;
  }
  if (run.issueNumber !== null) {
    return `Issue #${run.issueNumber}`;
  }
  if (run.deploymentUrl) {
    return run.deploymentUrl;
  }
  return run.externalId;
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

const STREAM_STATUS_LABELS: Record<StreamStatus, string> = {
  idle: "",
  connecting: "Connecting to live stream…",
  live: "Live streaming",
  reconnecting: "Reconnecting…",
  terminal: "Stream ended",
};

export function BackgroundRunDetail({
  initialData,
}: {
  initialData: BackgroundRunDetailData;
}) {
  const sseEnabled = isSseEnabled();
  const [streamRunStatus, setStreamRunStatus] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<SerializedBackgroundEvent[]>(
    [],
  );

  const onSseEvents = useCallback((newEvents: SerializedBackgroundEvent[]) => {
    setStreamEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const extra = newEvents.filter((e) => !seen.has(e.id));
      return extra.length > 0 ? [...prev, ...extra] : prev;
    });
  }, []);

  const onSseTerminal = useCallback((status: string) => {
    setStreamRunStatus(status);
  }, []);

  const { status: sseStatus } = useBackgroundRunEventSource({
    runId: initialData.run.id,
    enabled:
      sseEnabled &&
      initialData.run.status !== "succeeded" &&
      initialData.run.status !== "failed" &&
      initialData.run.status !== "skipped" &&
      initialData.run.status !== "cancelled",
    onEvents: onSseEvents,
    onTerminal: onSseTerminal,
  });

  const { data, error } = useSWR<BackgroundRunDetailData>(
    sseEnabled
      ? null // suppress SWR polling when SSE is enabled
      : `/api/background-agent-runs/${initialData.run.id}`,
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
  const { agent, outputs } = detail;

  // When SSE is enabled, merge stream events with initial data; when
  // a terminal status arrives via SSE, mirror it on the run object.
  const mergedRun: SerializedBackgroundRun = useMemo(() => {
    if (sseEnabled && streamRunStatus) {
      return { ...detail.run, status: streamRunStatus };
    }
    return detail.run;
  }, [sseEnabled, streamRunStatus, detail.run]);

  const mergedEvents: SerializedBackgroundEvent[] = useMemo(() => {
    if (!sseEnabled) return detail.events;
    if (streamEvents.length === 0) return detail.events;

    // Merge: stream events arrive later; deduplicate by id
    const seen = new Set(detail.events.map((e) => e.id));
    const extra = streamEvents.filter((e) => !seen.has(e.id));
    return [...detail.events, ...extra];
  }, [sseEnabled, detail.events, streamEvents]);

  const { run, events } = { run: mergedRun, events: mergedEvents };
  const runCost = formatRunCost(events);
  const isLive = run.status === "queued" || run.status === "running";
  const streamStatusLabel =
    sseEnabled && isLive ? STREAM_STATUS_LABELS[sseStatus] : null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
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
            {/* ARIA live region for stream connection status */}
            {streamStatusLabel && (
              <div
                aria-live="polite"
                className="mt-2 text-xs text-muted-foreground"
              >
                {streamStatusLabel}
              </div>
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

        <RunErrorBanner errorKind={run.errorKind} />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <ProofItem label="Status" value={run.status} />
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
          <ProofItem
            label="Permissions"
            value={formatPermissionSummary(agent)}
          />
          <ProofItem label="Checks" value={formatCheckSummary(events, agent)} />
          <ProofItem label="Output" value={formatOutputSummary(outputs)} />
          <ProofItem
            label="Duration"
            value={formatDuration(run.startedAt, run.finishedAt)}
          />
          {runCost && <ProofItem label="Cost" value={runCost} />}
        </section>

        <section className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">Event context</h2>
          </div>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Trigger kind
              </p>
              <p className="mt-1 font-mono text-xs">{run.triggerKind}</p>
            </div>
            {run.prNumber !== null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Pull request
                </p>
                <p className="mt-1 font-mono text-xs">PR #{run.prNumber}</p>
              </div>
            )}
            {run.issueNumber !== null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Issue
                </p>
                <p className="mt-1 font-mono text-xs">
                  Issue #{run.issueNumber}
                </p>
              </div>
            )}
            {run.deploymentUrl && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Deployment URL
                </p>
                <p className="mt-1 truncate font-mono text-xs">
                  {run.deploymentUrl}
                </p>
              </div>
            )}
            {run.branch && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Branch
                </p>
                <p className="mt-1 font-mono text-xs">{run.branch}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                External event ID
              </p>
              <p className="mt-1 truncate font-mono text-xs">
                {run.externalId}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {run.resultSummary ? (
              <RunSummarySection summary={run.resultSummary} />
            ) : null}
            <section className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Live timeline</h2>
                {isLive && (
                  <span className="text-xs text-muted-foreground">
                    {sseEnabled
                      ? sseStatus === "live"
                        ? "Streaming"
                        : sseStatus === "connecting" ||
                            sseStatus === "reconnecting"
                          ? "Connecting"
                          : "Refreshing"
                      : "Refreshing"}
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
                        {event.requestId && (
                          <span className="font-mono">
                            request {event.requestId}
                          </span>
                        )}
                        {event.sandboxName && (
                          <span className="font-mono">
                            sandbox {event.sandboxName}
                          </span>
                        )}
                        <span className="font-mono">
                          redaction {event.redactionStatus}
                        </span>
                        {event.errorKind && (
                          <span className="font-mono">{event.errorKind}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

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
                  <span className="font-mono">
                    {formatSidebarOutputKinds(outputs)}
                  </span>
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
                <h2 className="text-sm font-medium">Debug</h2>
              </div>
              <div className="divide-y divide-border text-sm">
                <DebugRow label="Run ID" value={run.id} />
                <DebugRow label="Request ID" value={run.requestId} />
                <DebugRow label="Workflow Run" value={run.workflowRunId} />
                <DebugRow label="Idempotency Key" value={run.idempotencyKey} />
                <DebugRow label="Source" value={run.source} />
                <DebugRow label="External Event" value={run.externalId} />
                <DebugRow label="Trigger Target" value={formatRunTarget(run)} />
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
                      {output.prNumber !== null && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          #{output.prNumber}
                        </p>
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
