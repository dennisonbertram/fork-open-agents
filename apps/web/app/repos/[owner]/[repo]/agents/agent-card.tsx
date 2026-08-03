"use client";

import {
  Play,
  Pause,
  RotateCcw,
  ExternalLink,
  Pencil,
  List,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { readApiError } from "@/lib/api/read-api-error";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { RunSummary } from "@/lib/background-agents/run-summary";
import { cn } from "@/lib/utils";
import { formatTriggerLabel } from "@/lib/background-agents/trigger-label";
import type { TriggerKind } from "@/lib/background-agents/agent-spec";
import { AgentScheduleCard } from "./agent-schedule-card";

// ---- Types ------------------------------------------------------------------

type AgentRunViewModel = {
  id: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled";
  errorKind: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  resultSummary: RunSummary | null | undefined;
  createdAt: Date;
};

// ---- Status polling ---------------------------------------------------------

type StatusResponse = {
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestOutputUrl: string | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load status");
  }
  return (await response.json()) as T;
}

/**
 * Polls /api/background-agents/:agentId/status only when the latest run is
 * active (running or queued). Returns null data when polling is not needed.
 */
function useAgentStatusPolling(
  agentId: string,
  isActive: boolean,
): StatusResponse | null {
  const { data } = useSWR<StatusResponse>(
    `/api/background-agents/${agentId}/status`,
    fetchJson,
    {
      refreshInterval: isActive ? 4000 : 0,
      revalidateOnFocus: false,
    },
  );
  return data ?? null;
}

type AgentCardProps = {
  agent: BackgroundAgentWithTriggers;
  latestRun: AgentRunViewModel | null;
  owner: string;
  repo: string;
};

// ---- Status helpers ---------------------------------------------------------

type CardStatus =
  | "never-run"
  | "running"
  | "queued"
  | "succeeded"
  | "failed"
  | "paused";

function deriveCardStatus(
  agent: BackgroundAgentWithTriggers,
  latestRun: AgentRunViewModel | null,
): CardStatus {
  if (agent.status === "disabled") {
    return "paused";
  }
  if (!latestRun) {
    return "never-run";
  }
  if (latestRun.status === "running") {
    return "running";
  }
  if (latestRun.status === "queued") {
    return "queued";
  }
  if (latestRun.status === "failed" || latestRun.status === "cancelled") {
    return "failed";
  }
  return "succeeded";
}

function StatusPill({ status }: { status: CardStatus }) {
  const label: Record<CardStatus, string> = {
    "never-run": "Never run",
    running: "Running",
    queued: "Queued",
    succeeded: "Succeeded",
    failed: "Failed",
    paused: "Paused",
  };

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium",
        status === "succeeded"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : status === "running" || status === "queued"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : status === "paused"
                ? "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {label[status]}
    </span>
  );
}

function TriggerLabel({
  kind,
  conditions,
}: {
  kind: string;
  conditions?: Record<string, string[]>;
}) {
  const isKnownKind = [
    "github.pull_request",
    "github.pull_request_review",
    "github.issue",
    "github.deployment_status",
    "schedule.cron",
    "webhook.error",
  ].includes(kind);

  const label = isKnownKind
    ? formatTriggerLabel(kind as TriggerKind, conditions ?? {})
    : kind;

  return (
    <span
      className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
      title={kind}
    >
      {label}
    </span>
  );
}

// ---- Main component ---------------------------------------------------------

/**
 * AgentCard — operational card for a configured background agent.
 * Shows status matrix, last-run summary, schedule info, and run controls.
 */
export function AgentCard({ agent, latestRun, owner, repo }: AgentCardProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isActive =
    latestRun?.status === "running" || latestRun?.status === "queued";

  // Poll for live status only when a run is active — no polling for idle agents.
  const polledStatus = useAgentStatusPolling(agent.id, isActive);

  // Use polled outputUrl if available, fall back to the server-rendered prop.
  const effectiveOutputUrl =
    polledStatus?.latestOutputUrl ?? latestRun?.outputUrl ?? null;

  const cardStatus = deriveCardStatus(agent, latestRun);
  const detailHref = `/repos/${owner}/${repo}/agents/${agent.id}`;
  const latestRunHref = latestRun ? `/background-runs/${latestRun.id}` : null;

  const scheduleTrigger =
    agent.triggers.find((t) => t.kind === "schedule.cron") ?? null;

  async function handleRunNow() {
    setIsPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/background-agents/${agent.id}/test`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        runIds?: string[];
        enabled?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(readApiError(body, "Failed to dispatch run").message);
      }
      const runId = body?.runIds?.[0];
      if (!runId) {
        throw new Error("No run was created");
      }
      router.push(`/background-runs/${runId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to dispatch run");
    } finally {
      setIsPending(false);
    }
  }

  async function handlePauseResume() {
    setIsPending(true);
    setMessage(null);
    try {
      const newStatus = agent.status === "enabled" ? "disabled" : "enabled";
      const response = await fetch(`/api/background-agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          readApiError(body, "Failed to update agent status").message,
        );
      }
      // Reload page to reflect new status
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-xs">
      {/* Header: name + status pill + detail link */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={detailHref}
              className="truncate text-sm font-semibold hover:underline"
            >
              {agent.name}
            </Link>
            <StatusPill status={cardStatus} />
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {agent.instructions}
          </p>
        </div>
        <Link
          href={detailHref}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`View details for ${agent.name}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Trigger labels */}
      {agent.triggers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.triggers.map((trigger) => (
            <TriggerLabel
              key={trigger.id}
              kind={trigger.kind}
              conditions={
                trigger.conditions as Record<string, string[]> | undefined
              }
            />
          ))}
        </div>
      )}

      {/* Schedule info (for schedule.cron triggers) */}
      {scheduleTrigger && (
        <div className="mt-3">
          <AgentScheduleCard trigger={scheduleTrigger} />
        </div>
      )}

      {/* Latest run summary */}
      {latestRun && (
        <div className="mt-3 rounded border border-border bg-muted/20 px-3 py-2 text-xs">
          {latestRun.resultSummary?.headline ? (
            <p className="text-foreground">
              {latestRun.resultSummary.headline}
            </p>
          ) : (
            <p className="text-muted-foreground capitalize">
              {latestRun.status}
            </p>
          )}
          {latestRun.status === "failed" && latestRun.errorKind && (
            <p className="mt-1 text-red-600 dark:text-red-400">
              {latestRun.errorKind}
              {latestRun.errorMessage ? `: ${latestRun.errorMessage}` : ""}
            </p>
          )}
          {latestRunHref && (
            <Link
              href={latestRunHref}
              className="mt-1 flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              View run <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}

      {cardStatus === "running" && latestRunHref && (
        <div className="mt-2">
          <Link
            href={latestRunHref}
            className="text-xs text-amber-600 hover:underline dark:text-amber-400"
          >
            View active run →
          </Link>
        </div>
      )}

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {cardStatus !== "running" && cardStatus !== "queued" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunNow}
            disabled={isPending}
          >
            <Play className="h-3.5 w-3.5" />
            Run now
          </Button>
        )}

        {agent.status === "enabled" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePauseResume}
            disabled={isPending}
          >
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePauseResume}
            disabled={isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Resume
          </Button>
        )}

        {/* Edit — links to the edit page for this agent */}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`${detailHref}/edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
        </Button>

        {/* View runs — links to the recent-runs section on the detail page */}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`${detailHref}#runs`}>
            <List className="h-3.5 w-3.5" />
            View runs
          </Link>
        </Button>
      </div>

      {/* Latest output — rendered below controls, only when a URL exists */}
      {effectiveOutputUrl && (
        <div className="mt-2">
          <a
            href={effectiveOutputUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Latest output
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {message && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
