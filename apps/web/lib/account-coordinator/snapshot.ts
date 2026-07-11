import { redactMetadata, redactText } from "./redaction";
import {
  adaptAgentLoopRun,
  adaptBackgroundAgentRun,
  adaptChatWorkflowRun,
} from "@/lib/runs/adapters";
import type { NormalizedRun, RunAttentionReason } from "@/lib/runs/types";
import {
  isRecentlyCompleted,
  isRunning,
  isStale,
  isWaitingOnUser,
  withAttention,
} from "./taxonomy";
import type {
  AccountScheduledAgent,
  AccountAttentionReason,
  AccountSnapshotResponse,
  AccountSnapshotSource,
  AccountSourceStatus,
  AccountWorkItem,
  AccountWorkStatus,
} from "./types";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;
const MAX_SECTION_ITEMS = 25;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const ATTENTION_PRIORITY: Record<AccountWorkStatus, number> = {
  failed: 0,
  waiting_on_user: 1,
  stale: 2,
  cancelled: 3,
  queued: 4,
  running: 4,
  completed: 4,
  skipped: 4,
  unknown: 0,
  scheduled: 4,
};

type SourceLoader<T> = () => Promise<T[]>;

export interface AccountSnapshotSourceLoaders {
  sessions: SourceLoader<SessionRow>;
  chatWorkflowRuns: SourceLoader<ChatWorkflowRunRow>;
  backgroundAgentRuns: SourceLoader<BackgroundAgentRunRow>;
  agentLoopRuns: SourceLoader<AgentLoopRunRow>;
  scheduledAgents: SourceLoader<AccountScheduledAgent>;
}

export interface AccountSnapshotOptions {
  userId: string;
  window: string | null;
  now?: Date;
  sourceLimit?: number;
  loaders?: Partial<AccountSnapshotSourceLoaders>;
}

export interface SnapshotWindow {
  requested: string;
  hours: number;
  since: Date;
}

export interface SessionRow {
  id: string;
  title: string;
  status: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  lifecycleState: string | null;
  lifecycleError: string | null;
  prNumber: number | null;
  prStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatWorkflowRunRow {
  id: string;
  chatId: string;
  chatTitle: string | null;
  sessionId: string;
  sessionTitle: string | null;
  status: string;
  runtimeMode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
}

export interface BackgroundAgentRunRow {
  id: string;
  agentName: string | null;
  status: string;
  source: string;
  triggerKind: string;
  repoOwner: string;
  repoName: string;
  branch: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  errorKind: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  payloadSummary: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AgentLoopRunRow {
  id: string;
  loopId: string;
  loopName: string | null;
  status: string;
  source: string;
  repoOwner: string | null;
  repoName: string | null;
  currentNodeId: string | null;
  stepCount: number;
  failedStepCount: number;
  errorKind: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export function parseSnapshotWindow(
  rawWindow: string | null,
  now: Date,
): SnapshotWindow {
  const requested = rawWindow ?? `${DEFAULT_WINDOW_HOURS}h`;
  const match = /^(\d{1,3})h$/.exec(requested);
  const parsedHours = match ? Number(match[1]) : DEFAULT_WINDOW_HOURS;
  const hours =
    Number.isInteger(parsedHours) && parsedHours > 0
      ? Math.min(parsedHours, MAX_WINDOW_HOURS)
      : DEFAULT_WINDOW_HOURS;

  return {
    requested,
    hours,
    since: new Date(now.getTime() - hours * 60 * 60 * 1000),
  };
}

function bounded<T>(items: T[]): T[] {
  return items.slice(0, MAX_SECTION_ITEMS);
}

function maybeRepo(
  owner: string | null | undefined,
  name: string | null | undefined,
  branch?: string | null,
) {
  if (!owner || !name) {
    return undefined;
  }

  return {
    owner,
    name,
    ...(branch ? { branch } : {}),
  };
}

function diagnosisHref(source: AccountWorkItem["source"], id: string): string {
  const params = new URLSearchParams({ source, id });
  return `/api/account/diagnosis?${params.toString()}`;
}

function markStale(
  status: AccountWorkStatus,
  updatedAt: Date,
  now: Date,
): AccountWorkStatus {
  if (
    (status === "queued" || status === "running") &&
    now.getTime() - updatedAt.getTime() > STALE_AFTER_MS
  ) {
    return "stale";
  }

  return status;
}

function failureSummary(
  label: string,
  errorKind?: string | null,
): string | undefined {
  if (errorKind) {
    const redactedKind = redactText(errorKind, 80);
    return redactedKind ? `${label}: ${redactedKind}` : label;
  }

  return undefined;
}

function normalizeSessionStatus(row: SessionRow, now: Date): AccountWorkStatus {
  if (row.lifecycleState === "failed" || row.status === "failed") {
    return "failed";
  }

  if (row.status === "completed" || row.status === "archived") {
    return "completed";
  }

  return markStale("running", row.updatedAt, now);
}

function accountStatusFromRun(run: NormalizedRun): AccountWorkStatus {
  if (
    run.attentionReasons.includes("stale") ||
    run.attentionReasons.includes("stalled")
  ) {
    return "stale";
  }

  switch (run.state) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "waiting":
      return "waiting_on_user";
    case "unknown":
      return "unknown";
    case "finished":
      switch (run.outcome) {
        case "succeeded":
          return "completed";
        case "failed":
          return "failed";
        case "cancelled":
          return "cancelled";
        case "skipped":
          return "skipped";
        case "unknown":
        case null:
          return "unknown";
      }
  }
}

function accountAttentionReasons(
  reasons: RunAttentionReason[],
): AccountAttentionReason[] {
  return reasons.flatMap((reason): AccountAttentionReason[] =>
    reason === "blocked" ? ["waiting_on_user"] : [reason],
  );
}

function canonicalRunMetadata(run: NormalizedRun) {
  return {
    normalizedRunId: run.id,
    nativeStatus: run.nativeStatus,
    nativeSource: run.nativeSource,
    runState: run.state,
    runOutcome: run.outcome,
    runHealth: run.health,
    detailUrl: run.detailUrl,
  };
}

export function normalizeSession(
  row: SessionRow,
  now = new Date(),
): AccountWorkItem {
  const status = normalizeSessionStatus(row, now);
  return withAttention({
    id: row.id,
    source: "session",
    title: redactText(row.title, 120) ?? "Untitled session",
    status,
    attentionReasons: [],
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    repo: maybeRepo(row.repoOwner, row.repoName, row.branch),
    diagnosisHref: diagnosisHref("session", row.id),
    summary: row.lifecycleError ? "Session failed" : undefined,
    metadata: redactMetadata({
      lifecycleState: row.lifecycleState,
      prNumber: row.prNumber,
      prStatus: row.prStatus,
    }),
  });
}

export function normalizeChatWorkflowRun(
  row: ChatWorkflowRunRow,
): AccountWorkItem {
  const run = adaptChatWorkflowRun({
    id: row.id,
    chatId: row.chatId,
    sessionId: row.sessionId,
    title:
      redactText(row.chatTitle ?? row.sessionTitle, 120) ?? "Chat workflow run",
    nativeStatus: row.status,
    runtimeMode: row.runtimeMode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
  const status = accountStatusFromRun(run);
  return withAttention({
    id: row.id,
    source: "chat_workflow",
    title: run.title,
    status,
    attentionReasons: accountAttentionReasons(run.attentionReasons),
    updatedAt: run.timestamps.updatedAt,
    createdAt: run.timestamps.startedAt ?? run.timestamps.createdAt,
    completedAt: run.timestamps.finishedAt ?? undefined,
    diagnosisHref: diagnosisHref("chat_workflow", row.id),
    summary:
      run.outcome === "failed" && row.errorMessage
        ? "Workflow failed"
        : undefined,
    metadata: redactMetadata({
      ...canonicalRunMetadata(run),
      chatId: row.chatId,
      sessionId: row.sessionId,
      runtimeMode: row.runtimeMode,
    }),
  });
}

export function normalizeBackgroundAgentRun(
  row: BackgroundAgentRunRow,
  now = new Date(),
): AccountWorkItem {
  const title =
    redactText(row.agentName, 120) ??
    redactText(String(row.payloadSummary.title ?? ""), 120) ??
    "Background agent run";
  const run = adaptBackgroundAgentRun(
    {
      id: row.id,
      title,
      nativeStatus: row.status,
      nativeSource: row.source,
      triggerKind: row.triggerKind,
      repoOwner: row.repoOwner,
      repoName: row.repoName,
      branch: row.branch,
      prNumber: row.prNumber,
      issueNumber: row.issueNumber,
      outputUrl: row.outputUrl,
      errorKind: row.errorKind,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    },
    { now, staleAfterMs: STALE_AFTER_MS },
  );
  const status = accountStatusFromRun(run);

  return withAttention({
    id: row.id,
    source: "background_agent",
    title: run.title,
    status,
    attentionReasons: accountAttentionReasons(run.attentionReasons),
    updatedAt: run.timestamps.updatedAt,
    createdAt: run.timestamps.createdAt,
    completedAt: run.timestamps.finishedAt ?? undefined,
    repo: run.repository ?? undefined,
    href: row.outputUrl ?? undefined,
    diagnosisHref: diagnosisHref("background_agent", row.id),
    summary:
      run.outcome === "failed" && row.errorMessage
        ? failureSummary("Background agent run failed", row.errorKind)
        : undefined,
    metadata: redactMetadata({
      ...canonicalRunMetadata(run),
      source: row.source,
      triggerKind: row.triggerKind,
      prNumber: row.prNumber,
      issueNumber: row.issueNumber,
      errorKind: row.errorKind,
      actor: row.payloadSummary.actor,
      action: row.payloadSummary.action,
    }),
  });
}

export function normalizeAgentLoopRun(
  row: AgentLoopRunRow,
  now = new Date(),
): AccountWorkItem {
  const run = adaptAgentLoopRun(
    {
      id: row.id,
      loopId: row.loopId,
      title: redactText(row.loopName, 120) ?? "Agent loop run",
      nativeStatus: row.status,
      nativeSource: row.source,
      repoOwner: row.repoOwner,
      repoName: row.repoName,
      currentNodeId: row.currentNodeId,
      stepCount: row.stepCount,
      failedStepCount: row.failedStepCount,
      errorKind: row.errorKind,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    },
    { now, staleAfterMs: STALE_AFTER_MS },
  );
  const status = accountStatusFromRun(run);
  return withAttention({
    id: row.id,
    source: "agent_loop",
    title: run.title,
    status,
    attentionReasons: accountAttentionReasons(run.attentionReasons),
    updatedAt: run.timestamps.updatedAt,
    createdAt: run.timestamps.createdAt,
    completedAt: run.timestamps.finishedAt ?? undefined,
    repo: run.repository ?? undefined,
    diagnosisHref: diagnosisHref("agent_loop", row.id),
    summary:
      row.failedStepCount > 0 && row.status === "completed"
        ? "Agent loop completed with failed steps"
        : run.outcome === "failed" && row.errorMessage
          ? failureSummary("Agent loop run failed", row.errorKind)
          : undefined,
    metadata: redactMetadata({
      ...canonicalRunMetadata(run),
      source: row.source,
      currentNodeId: row.currentNodeId,
      stepCount: row.stepCount,
      failedStepCount: row.failedStepCount,
      errorKind: row.errorKind,
    }),
  });
}

async function loadSource<T>(
  source: AccountSnapshotSource,
  loader: SourceLoader<T>,
): Promise<{ sourceStatus: AccountSourceStatus; items: T[] }> {
  try {
    const items = await loader();
    return {
      items,
      sourceStatus: { source, status: "ok", itemCount: items.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      sourceStatus: {
        source,
        status: "failed",
        itemCount: 0,
        error:
          redactText(message, 160) === "[redacted]"
            ? "[redacted]"
            : "Source failed",
      },
    };
  }
}

function sortItems(items: AccountWorkItem[]): AccountWorkItem[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function attentionGroupKey(item: AccountWorkItem): string {
  const repo = item.repo;
  const repoKey = repo
    ? `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`
    : null;

  if (!repoKey) {
    return `${item.source}:${item.id}`;
  }

  const prNumber = item.metadata?.prNumber;
  if (typeof prNumber === "number") {
    return `repo:${repoKey}:pr:${prNumber}`;
  }

  const issueNumber = item.metadata?.issueNumber;
  if (typeof issueNumber === "number") {
    return `repo:${repoKey}:issue:${issueNumber}`;
  }

  if (repo?.branch) {
    return `repo:${repoKey}:branch:${repo.branch.toLowerCase()}`;
  }

  return `${item.source}:${item.id}`;
}

function dedupeAttentionItems(items: AccountWorkItem[]): AccountWorkItem[] {
  const grouped = new Map<string, AccountWorkItem[]>();
  for (const item of items) {
    const key = attentionGroupKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return [...grouped.values()]
    .map((group) => {
      const [primary, ...related] = [...group].sort((a, b) => {
        const priorityDelta =
          ATTENTION_PRIORITY[a.status] - ATTENTION_PRIORITY[b.status];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });

      if (!primary || related.length === 0) {
        return primary;
      }

      return {
        ...primary,
        metadata: {
          ...primary.metadata,
          relatedItemCount: related.length,
          relatedSources: related.map((item) => item.source).join(","),
        },
      };
    })
    .filter((item): item is AccountWorkItem => item !== undefined);
}

export async function buildAccountSnapshot(
  options: AccountSnapshotOptions,
): Promise<AccountSnapshotResponse> {
  const now = options.now ?? new Date();
  const window = parseSnapshotWindow(options.window, now);
  const emptyLoader = async () => [];
  const loaders: AccountSnapshotSourceLoaders = {
    sessions: options.loaders?.sessions ?? emptyLoader,
    chatWorkflowRuns: options.loaders?.chatWorkflowRuns ?? emptyLoader,
    backgroundAgentRuns: options.loaders?.backgroundAgentRuns ?? emptyLoader,
    agentLoopRuns: options.loaders?.agentLoopRuns ?? emptyLoader,
    scheduledAgents: options.loaders?.scheduledAgents ?? emptyLoader,
  };

  const [
    sessionsResult,
    workflowRunsResult,
    backgroundRunsResult,
    agentLoopRunsResult,
    scheduledAgentsResult,
  ] = await Promise.all([
    loadSource("session", loaders.sessions),
    loadSource("chat_workflow", loaders.chatWorkflowRuns),
    loadSource("background_agent", loaders.backgroundAgentRuns),
    loadSource("agent_loop", loaders.agentLoopRuns),
    loadSource("scheduled_agents", loaders.scheduledAgents),
  ]);

  const items = sortItems([
    ...sessionsResult.items.map((row) => normalizeSession(row, now)),
    ...workflowRunsResult.items.map((row) => normalizeChatWorkflowRun(row)),
    ...backgroundRunsResult.items.map((row) =>
      normalizeBackgroundAgentRun(row, now),
    ),
    ...agentLoopRunsResult.items.map((row) => normalizeAgentLoopRun(row, now)),
  ]);

  return {
    generatedAt: now.toISOString(),
    window: {
      requested: window.requested,
      hours: window.hours,
      since: window.since.toISOString(),
    },
    sourceStatus: [
      sessionsResult.sourceStatus,
      workflowRunsResult.sourceStatus,
      backgroundRunsResult.sourceStatus,
      agentLoopRunsResult.sourceStatus,
      scheduledAgentsResult.sourceStatus,
    ],
    needsAttention: bounded(
      dedupeAttentionItems(items.filter((item) => item.needsAttention)),
    ),
    running: bounded(items.filter(isRunning)),
    recentlyCompleted: bounded(items.filter(isRecentlyCompleted)),
    waitingOnUser: bounded(items.filter(isWaitingOnUser)),
    stale: bounded(items.filter(isStale)),
    scheduledAgents: bounded(scheduledAgentsResult.items),
  };
}
