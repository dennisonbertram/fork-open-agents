"use client";

import { ArrowLeft, Bot, CheckCircle2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  RunMetadataTable,
  type RunMetadataRow,
} from "@/components/run-metadata-table";
import { RunDetailShell } from "@/app/runs/run-detail-shell";
import { buildBackgroundRunDetailSummary } from "@/app/runs/run-detail-summary";
import { RunErrorBanner } from "./run-error-banner";
import { RunSummarySection } from "./run-summary-section";
import { LiveTimeline } from "./live-timeline";
import {
  StatusPill,
  formatDate,
  stringifyPayloadValue,
} from "./timeline-format";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

// ── Run metadata rows (#895) ─────────────────────────────────────────────────

/**
 * Proof-strip rows for the terminal-style RunMetadataTable, replacing the
 * old content-sized ProofItem card grid. Every row here is already a STABLE
 * field on the run (nullable fields fall through to RunMetadataTable's "—"
 * placeholder instead of disappearing). Cost is genuinely conditional (only
 * derivable when an event payload carries a cost) and is appended last, at a
 * stable trailing position.
 */
function buildProofStripRows(
  run: SerializedBackgroundRun,
  agent: SerializedBackgroundAgent | null,
  events: SerializedBackgroundEvent[],
  outputs: SerializedBackgroundOutput[],
  runCost: string | null,
): RunMetadataRow[] {
  const rows: RunMetadataRow[] = [
    { key: "status", label: "Status", value: run.status },
    {
      key: "definition",
      label: "Definition",
      value:
        run.definitionVersion == null
          ? "Legacy"
          : `v${run.definitionVersion} · ${run.definitionHash?.slice(0, 12) ?? "invalid"}`,
    },
    {
      key: "snapshot-source",
      label: "Snapshot source",
      value: (run.snapshotSource ?? "legacy_live_fallback").replaceAll(
        "_",
        " ",
      ),
    },
    { key: "trigger", label: "Trigger", value: run.triggerKind },
    {
      key: "repository",
      label: "Repository",
      value: `${run.repoOwner}/${run.repoName}`,
    },
    { key: "ref", label: "Ref", value: run.sha ?? run.ref ?? run.branch },
    { key: "sandbox", label: "Sandbox", value: run.sandboxName },
    {
      key: "permissions",
      label: "Permissions",
      value: formatPermissionSummary(agent),
    },
    {
      key: "checks",
      label: "Checks",
      value: formatCheckSummary(events, agent),
    },
    { key: "output", label: "Output", value: formatOutputSummary(outputs) },
    {
      key: "duration",
      label: "Duration",
      value: formatDuration(run.startedAt, run.finishedAt),
    },
  ];

  if (runCost) {
    rows.push({ key: "cost", label: "Cost", value: runCost });
  }

  return rows;
}

/** Debug sidebar rows — same stable-placeholder terminal-style treatment. */
function buildDebugRows(run: SerializedBackgroundRun): RunMetadataRow[] {
  return [
    { key: "run-id", label: "Run ID", value: run.id },
    { key: "request-id", label: "Request ID", value: run.requestId },
    { key: "workflow-run", label: "Workflow Run", value: run.workflowRunId },
    {
      key: "idempotency-key",
      label: "Idempotency Key",
      value: run.idempotencyKey,
    },
    { key: "source", label: "Source", value: run.source },
    { key: "external-event", label: "External Event", value: run.externalId },
    {
      key: "trigger-target",
      label: "Trigger Target",
      value: formatRunTarget(run),
    },
  ];
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
  variant = "legacy",
}: {
  initialData: BackgroundRunDetailData;
  variant?: "legacy" | "canonical";
}) {
  const sseEnabled = isSseEnabled();
  const [streamRunStatus, setStreamRunStatus] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<SerializedBackgroundEvent[]>(
    [],
  );
  const [terminalData, setTerminalData] =
    useState<BackgroundRunDetailData | null>(null);
  const [terminalRefreshFailed, setTerminalRefreshFailed] = useState(false);

  const onSseEvents = useCallback((newEvents: SerializedBackgroundEvent[]) => {
    setStreamEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const extra = newEvents.filter((e) => !seen.has(e.id));
      return extra.length > 0 ? [...prev, ...extra] : prev;
    });
  }, []);

  const onSseTerminal = useCallback(
    (status: string) => {
      setStreamRunStatus(status);
      setTerminalRefreshFailed(false);
      void fetchJson<BackgroundRunDetailData>(
        `/api/background-agent-runs/${encodeURIComponent(initialData.run.id)}`,
      )
        .then(setTerminalData)
        .catch(() => setTerminalRefreshFailed(true));
    },
    [initialData.run.id],
  );

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

  const detail = terminalData ?? data ?? initialData;
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

  // Backfill run-level identifiers (workflow run / sandbox / request id) from
  // the stream events when the run object itself hasn't been populated yet.
  // With SSE enabled, SWR polling is suppressed and `mergedRun` only picks up
  // the terminal status — so a queued run opened before the executor set these
  // fields would otherwise show them nowhere (they were removed from the
  // per-event footer to cut noise, and the sidebar's copy is still null).
  const runWithLiveIds: SerializedBackgroundRun = useMemo(() => {
    if (
      mergedRun.workflowRunId &&
      mergedRun.sandboxName &&
      mergedRun.requestId
    ) {
      return mergedRun;
    }
    let workflowRunId = mergedRun.workflowRunId;
    let sandboxName = mergedRun.sandboxName;
    let requestId = mergedRun.requestId;
    for (const event of mergedEvents) {
      workflowRunId ||= event.workflowRunId;
      sandboxName ||= event.sandboxName;
      requestId ||= event.requestId;
      if (workflowRunId && sandboxName && requestId) {
        break;
      }
    }
    return { ...mergedRun, workflowRunId, sandboxName, requestId };
  }, [mergedRun, mergedEvents]);

  const { run, events } = { run: runWithLiveIds, events: mergedEvents };
  const runCost = formatRunCost(events);
  const isLive = run.status === "queued" || run.status === "running";
  const streamStatusLabel =
    sseEnabled && isLive ? STREAM_STATUS_LABELS[sseStatus] : null;
  const timelineStatusLabel = isLive
    ? sseEnabled
      ? sseStatus === "live"
        ? "Streaming"
        : sseStatus === "connecting" || sseStatus === "reconnecting"
          ? "Connecting"
          : "Refreshing"
      : "Refreshing"
    : null;

  const nativeDetail = (
    <>
      <RunErrorBanner errorKind={run.errorKind} />

      <RunMetadataTable
        rows={buildProofStripRows(run, agent, events, outputs, runCost)}
      />

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
              <p className="mt-1 font-mono text-xs">Issue #{run.issueNumber}</p>
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
            <p className="mt-1 truncate font-mono text-xs">{run.externalId}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {run.resultSummary ? (
            <RunSummarySection summary={run.resultSummary} />
          ) : null}
          <LiveTimeline
            events={events}
            isLive={isLive}
            statusLabel={timelineStatusLabel}
          />
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

          <RunMetadataTable heading="Debug" rows={buildDebugRows(run)} />

          <section className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">Outputs</h2>
              {outputs.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {outputs.length}
                </span>
              )}
            </div>
            {outputs.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No outputs recorded.
              </div>
            ) : (
              <div className="max-h-[24rem] divide-y divide-border overflow-y-auto">
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
    </>
  );

  const outputLink = run.outputUrl ? (
    <Link
      href={run.outputUrl}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      Output
      <ExternalLink className="h-4 w-4" />
    </Link>
  ) : null;

  if (variant === "canonical") {
    return (
      <RunDetailShell
        summary={buildBackgroundRunDetailSummary({
          run,
          agent,
          events,
          outputs,
        })}
        headerAction={outputLink}
        statusMessage={
          terminalRefreshFailed
            ? "Final evidence refresh failed. Last known evidence is shown."
            : error
              ? "Live refresh failed. Existing evidence is still shown."
              : streamStatusLabel
        }
      >
        {nativeDetail}
      </RunDetailShell>
    );
  }

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
            {terminalRefreshFailed && (
              <p role="status" className="mt-2 text-xs text-destructive">
                Final evidence refresh failed. Last known evidence is shown.
              </p>
            )}
            {streamStatusLabel && (
              <div
                aria-live="polite"
                className="mt-2 text-xs text-muted-foreground"
              >
                {streamStatusLabel}
              </div>
            )}
          </div>
          {outputLink}
        </div>

        {nativeDetail}
      </div>
    </main>
  );
}

export type { BackgroundRunDetailData };
