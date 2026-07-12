import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { canonicalLoopAutomationDetailUrl } from "@/lib/automations/definition-routes";
import type { BackgroundRunDetailData } from "@/app/background-runs/[runId]/types";
import {
  DEFAULT_RUN_STALE_AFTER_MS,
  normalizeRunStatus,
} from "@/lib/runs/status";
import type {
  AutomationRunSource,
  AutomationTriggerSource,
  RunAttentionReason,
  RunHealth,
  RunOutcome,
  RunState,
} from "@/lib/runs/types";

export type RunDetailShellSummary = {
  source: AutomationRunSource;
  runId: string;
  automation: { name: string; sourceId: string | null; href: string | null };
  repository: { owner: string; name: string; href: string } | null;
  trigger: {
    id: string | null;
    source: AutomationTriggerSource;
    kind: string | null;
  };
  nativeStatus: string;
  state: RunState;
  outcome: RunOutcome;
  health: RunHealth;
  attentionReasons: RunAttentionReason[];
  timestamps: {
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  evidence: {
    source: string;
    requestId: string | null;
    workflowRunId: string | null;
    sandboxName: string | null;
  };
};

function triggerSource(value: string): AutomationTriggerSource {
  if (
    value === "github" ||
    value === "schedule" ||
    value === "webhook" ||
    value === "manual"
  ) {
    return value;
  }
  return "unknown";
}

function toIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

type SummaryOptions = {
  now?: Date;
  variant?: "legacy" | "canonical";
};

function isStale(value: Date | string, options: SummaryOptions): boolean {
  const updatedAt = new Date(value).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  const now = options.now?.getTime() ?? Date.now();
  return now - updatedAt > DEFAULT_RUN_STALE_AFTER_MS;
}

export function buildBackgroundRunDetailSummary(
  detail: BackgroundRunDetailData,
  options: SummaryOptions = {},
): RunDetailShellSummary {
  const { run, agent } = detail;
  const status = normalizeRunStatus({
    source: "background_agent",
    nativeStatus: run.status,
    isStale: isStale(run.updatedAt, options),
  });

  return {
    source: "background_agent",
    runId: run.id,
    automation: {
      name: agent?.name ?? "Deleted Automation",
      sourceId: agent?.id ?? null,
      href: agent
        ? `/repos/${encodeURIComponent(run.repoOwner)}/${encodeURIComponent(run.repoName)}/agents/${encodeURIComponent(agent.id)}`
        : null,
    },
    repository: {
      owner: run.repoOwner,
      name: run.repoName,
      href: `/repos/${encodeURIComponent(run.repoOwner)}/${encodeURIComponent(run.repoName)}`,
    },
    trigger: {
      id: run.triggerId,
      source: triggerSource(run.source),
      kind: run.triggerKind,
    },
    nativeStatus: run.status,
    ...status,
    timestamps: {
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    evidence: {
      source: "Background agent events and outputs",
      requestId: run.requestId,
      workflowRunId: run.workflowRunId,
      sandboxName: run.sandboxName,
    },
  };
}

export function buildLoopRunDetailSummary(
  detail: GetAgentLoopRunDetailResponse,
  options: SummaryOptions = {},
): RunDetailShellSummary {
  const { run, loop, steps } = detail;
  const status = normalizeRunStatus({
    source: "agent_loop",
    nativeStatus: run.status,
    isStale: isStale(run.updatedAt, options),
    failedStepCount: steps.filter((step) => step.status === "failed").length,
  });

  return {
    source: "agent_loop",
    runId: run.id,
    automation: {
      name: loop?.name ?? "Deleted automation",
      sourceId: loop?.id ?? null,
      href: loop
        ? options.variant === "canonical"
          ? canonicalLoopAutomationDetailUrl(loop.id)
          : `/loops/${encodeURIComponent(loop.id)}`
        : null,
    },
    repository: loop
      ? {
          owner: loop.repoOwner,
          name: loop.repoName,
          href: `/repos/${encodeURIComponent(loop.repoOwner)}/${encodeURIComponent(loop.repoName)}`,
        }
      : null,
    trigger: {
      id: run.triggerId,
      source: triggerSource(run.source),
      // The run row retains trigger identity/source but not a denormalized
      // trigger kind. Keep it explicitly unknown instead of guessing.
      kind: null,
    },
    nativeStatus: run.status,
    ...status,
    timestamps: {
      createdAt: new Date(run.createdAt).toISOString(),
      updatedAt: new Date(run.updatedAt).toISOString(),
      startedAt: toIso(run.startedAt),
      finishedAt: toIso(run.finishedAt),
    },
    evidence: {
      source: "Loop graph, steps, events, and watchdog decisions",
      requestId: run.requestId,
      workflowRunId: run.workflowRunId,
      sandboxName: steps.find((step) => step.sandboxName)?.sandboxName ?? null,
    },
  };
}
