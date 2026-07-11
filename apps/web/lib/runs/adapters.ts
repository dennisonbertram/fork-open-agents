import { DEFAULT_RUN_STALE_AFTER_MS, normalizeRunStatus } from "./status";
import type {
  AutomationRunSource,
  AutomationTriggerSource,
  NormalizedAutomationRun,
  NormalizedRun,
  NormalizedRunId,
  NormalizedRunMetadata,
  RunRepository,
  RunSource,
} from "./types";

interface BaseRunAdapterInput {
  id: string;
  title: string;
  nativeStatus: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ChatWorkflowRunAdapterInput extends BaseRunAdapterInput {
  chatId: string;
  sessionId: string;
  runtimeMode: string | null;
  finishedAt: Date;
}

export interface BackgroundAgentRunAdapterInput extends BaseRunAdapterInput {
  agentId?: string | null;
  triggerId?: string | null;
  nativeSource: string;
  triggerKind: string;
  repoOwner: string;
  repoName: string;
  branch: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  outputUrl: string | null;
  errorKind: string | null;
  sandboxName?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  updatedAt: Date;
}

export interface AgentLoopRunAdapterInput extends BaseRunAdapterInput {
  loopId: string;
  triggerId?: string | null;
  triggerKind?: string | null;
  nativeSource: string;
  repoOwner: string | null;
  repoName: string | null;
  currentNodeId: string | null;
  stepCount: number;
  totalStepCount?: number | null;
  failedStepCount: number;
  errorKind: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  updatedAt: Date;
}

export interface RunAdapterOptions {
  now?: Date;
  staleAfterMs?: number;
}

export function qualifyRunId(
  source: RunSource,
  sourceId: string,
): NormalizedRunId {
  return `${source}:${sourceId}`;
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function repository(
  owner: string | null,
  name: string | null,
  branch?: string | null,
): RunRepository | null {
  if (!(owner && name)) {
    return null;
  }

  return {
    owner,
    name,
    ...(branch ? { branch } : {}),
  };
}

function isStale(updatedAt: Date, options: RunAdapterOptions): boolean {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_RUN_STALE_AFTER_MS;
  return now.getTime() - updatedAt.getTime() > staleAfterMs;
}

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

function automationContext(params: {
  source: AutomationRunSource;
  sourceId: string | null | undefined;
  name: string;
  triggerId: string | null | undefined;
  triggerSource: string;
  triggerKind: string | null | undefined;
  currentStepId: string | null;
  completedSteps: number | null;
  totalSteps: number | null;
  requestId: string | null | undefined;
  workflowRunId: string | null | undefined;
  sandboxName: string | null | undefined;
  outputUrl: string | null | undefined;
}) {
  return {
    automation: params.sourceId
      ? { source: params.source, sourceId: params.sourceId }
      : null,
    automationName: params.name,
    trigger: {
      id: params.triggerId ?? null,
      source: triggerSource(params.triggerSource),
      kind: params.triggerKind ?? null,
    },
    progress: {
      currentStepId: params.currentStepId,
      completedSteps: params.completedSteps,
      totalSteps: params.totalSteps,
    },
    evidence: {
      requestId: params.requestId ?? null,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      outputUrl: params.outputUrl ?? null,
    },
  };
}

function buildRun(params: {
  source: RunSource;
  sourceId: string;
  nativeStatus: string;
  nativeSource: string | null;
  title: string;
  repository: RunRepository | null;
  detailUrl: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  metadata: NormalizedRunMetadata;
  status: ReturnType<typeof normalizeRunStatus>;
}): NormalizedRun {
  return {
    id: qualifyRunId(params.source, params.sourceId),
    source: params.source,
    sourceId: params.sourceId,
    nativeStatus: params.nativeStatus,
    nativeSource: params.nativeSource,
    title: params.title,
    ...params.status,
    repository: params.repository,
    detailUrl: params.detailUrl,
    timestamps: {
      createdAt: params.createdAt.toISOString(),
      updatedAt: params.updatedAt.toISOString(),
      startedAt: toIso(params.startedAt),
      finishedAt: toIso(params.finishedAt),
    },
    metadata: params.metadata,
  };
}

export function adaptChatWorkflowRun(
  input: ChatWorkflowRunAdapterInput,
): NormalizedRun {
  return buildRun({
    source: "chat_workflow",
    sourceId: input.id,
    nativeStatus: input.nativeStatus,
    nativeSource: null,
    title: input.title,
    repository: null,
    detailUrl: `/sessions/${encodeURIComponent(input.sessionId)}/chats/${encodeURIComponent(input.chatId)}`,
    createdAt: input.createdAt,
    updatedAt: input.finishedAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    metadata: {
      chatId: input.chatId,
      sessionId: input.sessionId,
      runtimeMode: input.runtimeMode,
    },
    status: normalizeRunStatus({
      source: "chat_workflow",
      nativeStatus: input.nativeStatus,
    }),
  });
}

export function adaptBackgroundAgentRun(
  input: BackgroundAgentRunAdapterInput,
  options: RunAdapterOptions = {},
): NormalizedAutomationRun {
  const run = buildRun({
    source: "background_agent",
    sourceId: input.id,
    nativeStatus: input.nativeStatus,
    nativeSource: input.nativeSource,
    title: input.title,
    repository: repository(input.repoOwner, input.repoName, input.branch),
    detailUrl: `/background-runs/${encodeURIComponent(input.id)}`,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    metadata: {
      triggerKind: input.triggerKind,
      prNumber: input.prNumber,
      issueNumber: input.issueNumber,
      outputUrl: input.outputUrl,
      errorKind: input.errorKind,
    },
    status: normalizeRunStatus({
      source: "background_agent",
      nativeStatus: input.nativeStatus,
      isStale: isStale(input.updatedAt, options),
    }),
  });
  return {
    ...run,
    source: "background_agent",
    ...automationContext({
      source: "background_agent",
      sourceId: input.agentId,
      name: input.title,
      triggerId: input.triggerId,
      triggerSource: input.nativeSource,
      triggerKind: input.triggerKind,
      currentStepId: null,
      completedSteps:
        run.state === "finished" && input.startedAt !== null ? 1 : 0,
      totalSteps: 1,
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      sandboxName: input.sandboxName,
      outputUrl: input.outputUrl,
    }),
  };
}

export function adaptAgentLoopRun(
  input: AgentLoopRunAdapterInput,
  options: RunAdapterOptions = {},
): NormalizedAutomationRun {
  const run = buildRun({
    source: "agent_loop",
    sourceId: input.id,
    nativeStatus: input.nativeStatus,
    nativeSource: input.nativeSource,
    title: input.title,
    repository: repository(input.repoOwner, input.repoName),
    detailUrl: `/loops/${encodeURIComponent(input.loopId)}/runs/${encodeURIComponent(input.id)}`,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    metadata: {
      loopId: input.loopId,
      currentNodeId: input.currentNodeId,
      stepCount: input.stepCount,
      failedStepCount: input.failedStepCount,
      errorKind: input.errorKind,
    },
    status: normalizeRunStatus({
      source: "agent_loop",
      nativeStatus: input.nativeStatus,
      isStale: isStale(input.updatedAt, options),
      failedStepCount: input.failedStepCount,
    }),
  });
  return {
    ...run,
    source: "agent_loop",
    ...automationContext({
      source: "agent_loop",
      sourceId: input.loopId,
      name: input.title,
      triggerId: input.triggerId,
      triggerSource: input.nativeSource,
      triggerKind: input.triggerKind,
      currentStepId: input.currentNodeId,
      completedSteps: input.stepCount,
      totalSteps: input.totalStepCount ?? null,
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      sandboxName: null,
      outputUrl: null,
    }),
  };
}
