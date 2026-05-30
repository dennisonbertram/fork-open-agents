import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import type { WebAgentUIMessage, WebAgentUIMessagePart } from "@/app/types";
import { db } from "@/lib/db/client";
import {
  chatMessages,
  managedRuntimeProfileRuns,
  sessionEvents,
  sessions,
  workflowRuns,
  type AgentApiRun,
  type ChatMessage,
  type SessionEvent,
} from "@/lib/db/schema";

export type AgentRunSnapshot = {
  id: string;
  status: AgentApiRun["status"];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestId: string | null;
  sessionId: string | null;
  chatId: string | null;
  workflowRunId: string | null;
  repository: AgentApiRun["repository"];
  runtimeMode: AgentApiRun["runtimeMode"];
  managedRuntimeProfileId: string | null;
  sandboxName: string | null;
  modelId: string | null;
  inferenceRoute: string | null;
  inferenceProfileId: string | null;
  latestAssistantMessage: ApiMessageSnapshot | null;
  failure: {
    kind: string | null;
    message: string | null;
    retryable: boolean | null;
  } | null;
  links: {
    status: string;
    events: string;
    messages: string;
    proof: string;
    cancel: string;
    ui: string | null;
  };
};

export type ApiMessageSnapshot = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  metadata: WebAgentUIMessage["metadata"] | null;
  outputs: {
    commit?: unknown;
    pr?: unknown;
    runtimeProof?: unknown;
  };
  uiParts?: WebAgentUIMessage["parts"];
};

export function buildAgentRunLinks(runId: string, run: AgentApiRun) {
  return {
    status: `/api/v1/agent-runs/${runId}`,
    events: `/api/v1/agent-runs/${runId}/events`,
    messages: `/api/v1/agent-runs/${runId}/messages`,
    proof: `/api/v1/agent-runs/${runId}/proof`,
    cancel: `/api/v1/agent-runs/${runId}/cancel`,
    ui:
      run.sessionId && run.chatId
        ? `/sessions/${run.sessionId}/chats/${run.chatId}`
        : null,
  };
}

function isUiMessage(value: unknown): value is WebAgentUIMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "role" in value &&
    "parts" in value &&
    Array.isArray(value.parts)
  );
}

function textFromPart(part: WebAgentUIMessagePart): string {
  if (part.type === "text") {
    return part.text;
  }
  return "";
}

export function toApiMessageSnapshot(
  row: ChatMessage,
  includeUiParts = false,
): ApiMessageSnapshot {
  const message = isUiMessage(row.parts) ? row.parts : null;
  const parts = message?.parts ?? [];
  const outputs: ApiMessageSnapshot["outputs"] = {};

  for (const part of parts) {
    if (part.type === "data-commit") {
      outputs.commit = part.data;
    }
    if (part.type === "data-pr") {
      outputs.pr = part.data;
    }
    if (part.type === "data-runtime-proof") {
      outputs.runtimeProof = part.data;
    }
  }

  return {
    id: row.id,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    text: parts.map(textFromPart).join("").trim(),
    metadata: message?.metadata ?? null,
    outputs,
    ...(includeUiParts && message ? { uiParts: message.parts } : {}),
  };
}

export async function getAgentRunSnapshot(
  run: AgentApiRun,
): Promise<AgentRunSnapshot> {
  const latestAssistantMessage =
    run.chatId == null
      ? null
      : await db.query.chatMessages.findFirst({
          where: and(
            eq(chatMessages.chatId, run.chatId),
            eq(chatMessages.role, "assistant"),
          ),
          orderBy: [desc(chatMessages.createdAt)],
        });

  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    requestId: run.requestId,
    sessionId: run.sessionId,
    chatId: run.chatId,
    workflowRunId: run.workflowRunId,
    repository: run.repository,
    runtimeMode: run.runtimeMode,
    managedRuntimeProfileId: run.managedRuntimeProfileId,
    sandboxName: run.sandboxName,
    modelId: run.modelId,
    inferenceRoute: run.inferenceRoute,
    inferenceProfileId: run.inferenceProfileId,
    latestAssistantMessage: latestAssistantMessage
      ? toApiMessageSnapshot(latestAssistantMessage)
      : null,
    failure:
      run.failureKind || run.failureMessage
        ? {
            kind: run.failureKind,
            message: run.failureMessage,
            retryable: run.failureRetryable,
          }
        : null,
    links: buildAgentRunLinks(run.id, run),
  };
}

export async function listAgentRunMessages(params: {
  chatId: string;
  includeUiParts?: boolean;
}): Promise<ApiMessageSnapshot[]> {
  const rows = await db.query.chatMessages.findMany({
    where: eq(chatMessages.chatId, params.chatId),
    orderBy: [asc(chatMessages.createdAt)],
  });
  return rows.map((row) => toApiMessageSnapshot(row, params.includeUiParts));
}

export function toApiEventSnapshot(event: SessionEvent) {
  return {
    id: event.id,
    eventName: event.eventName,
    status: event.status,
    source: event.source,
    actorType: event.actorType,
    summary: event.summary,
    requestId: event.requestId,
    workflowRunId: event.workflowRunId,
    sandboxName: event.sandboxName,
    managedRuntimeProfileRunId: event.managedRuntimeProfileRunId,
    payload: event.payload,
    redactionStatus: event.redactionStatus,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function listAgentRunEvents(params: {
  sessionId: string;
  chatId: string | null;
  workflowRunId: string | null;
  requestId: string | null;
  after?: string;
  limit: number;
}) {
  const afterEvent = params.after
    ? await db.query.sessionEvents.findFirst({
        where: eq(sessionEvents.id, params.after),
      })
    : null;
  const afterFilter = afterEvent
    ? gt(sessionEvents.createdAt, afterEvent.createdAt)
    : undefined;

  const scope = or(
    eq(sessionEvents.sessionId, params.sessionId),
    params.chatId ? eq(sessionEvents.chatId, params.chatId) : undefined,
    params.workflowRunId
      ? eq(sessionEvents.workflowRunId, params.workflowRunId)
      : undefined,
    params.requestId
      ? eq(sessionEvents.requestId, params.requestId)
      : undefined,
  );
  const where = afterFilter ? and(scope, afterFilter) : scope;

  const rows = await db.query.sessionEvents.findMany({
    where,
    orderBy: params.after
      ? [asc(sessionEvents.createdAt)]
      : [desc(sessionEvents.createdAt)],
    limit: params.limit,
  });

  return rows.map(toApiEventSnapshot);
}

export async function getAgentRunEvidence(run: AgentApiRun) {
  const [session, workflowRun, profileRun] = await Promise.all([
    run.sessionId
      ? db.query.sessions.findFirst({ where: eq(sessions.id, run.sessionId) })
      : null,
    run.workflowRunId
      ? db.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, run.workflowRunId),
        })
      : null,
    run.workflowRunId
      ? db.query.managedRuntimeProfileRuns.findFirst({
          where: eq(managedRuntimeProfileRuns.workflowRunId, run.workflowRunId),
          orderBy: [desc(managedRuntimeProfileRuns.createdAt)],
        })
      : null,
  ]);

  return { session, workflowRun, profileRun };
}
