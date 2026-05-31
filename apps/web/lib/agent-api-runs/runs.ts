import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  agentApiRuns,
  chatMessages,
  chats,
  sessions,
  workflowRuns,
  type AgentApiRun,
  type NewAgentApiRun,
} from "@/lib/db/schema";

export type AgentApiRunStatus = AgentApiRun["status"];

export async function createAgentApiRun(
  data: Omit<NewAgentApiRun, "createdAt" | "updatedAt">,
): Promise<{ run: AgentApiRun; replayed: boolean }> {
  const [created] = await db
    .insert(agentApiRuns)
    .values(data)
    .onConflictDoNothing({
      target: [
        agentApiRuns.userId,
        agentApiRuns.tokenId,
        agentApiRuns.idempotencyKeyHash,
      ],
    })
    .returning();
  if (created) {
    return { run: created, replayed: false };
  }

  if (!data.idempotencyKeyHash || !data.tokenId) {
    throw new Error("Failed to create API run");
  }

  const existing = await db.query.agentApiRuns.findFirst({
    where: and(
      eq(agentApiRuns.userId, data.userId),
      eq(agentApiRuns.tokenId, data.tokenId),
      eq(agentApiRuns.idempotencyKeyHash, data.idempotencyKeyHash),
    ),
  });

  if (!existing) {
    throw new Error("Failed to create API run");
  }

  return { run: existing, replayed: true };
}

export async function getAgentApiRunForToken(params: {
  runId: string;
  userId: string;
  tokenId: string;
}): Promise<AgentApiRun | null> {
  return (
    (await db.query.agentApiRuns.findFirst({
      where: and(
        eq(agentApiRuns.id, params.runId),
        eq(agentApiRuns.userId, params.userId),
        eq(agentApiRuns.tokenId, params.tokenId),
      ),
    })) ?? null
  );
}

export async function listAgentApiRunsForToken(params: {
  userId: string;
  tokenId: string;
  status?: AgentApiRunStatus;
  limit: number;
}): Promise<AgentApiRun[]> {
  const where = params.status
    ? and(
        eq(agentApiRuns.userId, params.userId),
        eq(agentApiRuns.tokenId, params.tokenId),
        eq(agentApiRuns.status, params.status),
      )
    : and(
        eq(agentApiRuns.userId, params.userId),
        eq(agentApiRuns.tokenId, params.tokenId),
      );

  return db.query.agentApiRuns.findMany({
    where,
    orderBy: [desc(agentApiRuns.createdAt)],
    limit: params.limit,
  });
}

export async function attachAgentApiRunWorkflow(params: {
  runId: string;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
}): Promise<AgentApiRun> {
  const [run] = await db
    .update(agentApiRuns)
    .set({
      sessionId: params.sessionId,
      chatId: params.chatId,
      workflowRunId: params.workflowRunId,
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentApiRuns.id, params.runId))
    .returning();

  if (!run) {
    throw new Error("Failed to attach API run workflow");
  }

  return run;
}

export async function markAgentApiRunFailed(params: {
  runId: string;
  kind: string;
  message: string;
  retryable?: boolean;
}): Promise<void> {
  await db
    .update(agentApiRuns)
    .set({
      status: "failed",
      failureKind: params.kind,
      failureMessage: params.message,
      failureRetryable: params.retryable ?? false,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentApiRuns.id, params.runId));
}

export async function finalizeAgentApiRunFromWorkflow(params: {
  runId: string;
  workflowRunId: string;
  status: "completed" | "aborted" | "failed";
  errorMessage?: string | null;
  sandboxName?: string | null;
  modelId?: string | null;
  inferenceRoute?: "gateway" | "user" | null;
  inferenceProfileId?: string | null;
  managedRuntimeProfileId?: string | null;
  resultMessageId?: string | null;
  finishedAt: Date;
}): Promise<void> {
  await db
    .update(agentApiRuns)
    .set({
      status:
        params.status === "completed"
          ? "completed"
          : params.status === "aborted"
            ? "cancelled"
            : "failed",
      workflowRunId: params.workflowRunId,
      sandboxName: params.sandboxName ?? null,
      modelId: params.modelId ?? null,
      inferenceRoute: params.inferenceRoute ?? null,
      inferenceProfileId: params.inferenceProfileId ?? null,
      managedRuntimeProfileId: params.managedRuntimeProfileId ?? null,
      resultMessageId: params.resultMessageId ?? null,
      failureKind: params.status === "failed" ? "workflow_failed" : null,
      failureMessage: params.errorMessage ?? null,
      failureRetryable: params.status === "failed" ? true : null,
      finishedAt: params.finishedAt,
      updatedAt: new Date(),
    })
    .where(eq(agentApiRuns.id, params.runId));
}

// Workflow statuses that indicate the workflow has fully stopped.
// Only these states should trigger a self-heal transition on the agent API run.
const TERMINAL_WORKFLOW_STATUSES = ["completed", "failed", "aborted"] as const;
type TerminalWorkflowStatus = (typeof TERMINAL_WORKFLOW_STATUSES)[number];

function isTerminalWorkflowStatus(
  status: string,
): status is TerminalWorkflowStatus {
  return (TERMINAL_WORKFLOW_STATUSES as readonly string[]).includes(status);
}

export async function selfHealAgentApiRunStatus(
  run: AgentApiRun,
): Promise<AgentApiRun> {
  if (!run.workflowRunId || run.finishedAt) {
    return run;
  }

  const workflowRun = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, run.workflowRunId),
  });
  if (!workflowRun) {
    return run;
  }

  // Only transition when the workflow is in a terminal state.
  // Non-terminal states (running, queued, starting, etc.) must be ignored
  // to avoid incorrectly marking a running workflow as failed.
  if (!isTerminalWorkflowStatus(workflowRun.status)) {
    return run;
  }

  const [updated] = await db
    .update(agentApiRuns)
    .set({
      status:
        workflowRun.status === "completed"
          ? "completed"
          : workflowRun.status === "aborted"
            ? "cancelled"
            : "failed",
      sandboxName: workflowRun.sandboxName,
      modelId: workflowRun.modelId,
      inferenceRoute: workflowRun.inferenceRoute,
      inferenceProfileId: workflowRun.inferenceProfileId,
      managedRuntimeProfileId: workflowRun.managedRuntimeProfileId,
      failureKind: workflowRun.status === "failed" ? "workflow_failed" : null,
      failureMessage: workflowRun.errorMessage,
      failureRetryable: workflowRun.status === "failed" ? true : null,
      finishedAt: workflowRun.finishedAt,
      updatedAt: new Date(),
    })
    .where(eq(agentApiRuns.id, run.id))
    .returning();

  return updated ?? run;
}

export async function createApiRunId(): Promise<string> {
  return `arun_${nanoid()}`;
}

export async function getLatestAssistantMessageId(
  chatId: string,
): Promise<string | null> {
  const [message] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  return message?.id ?? null;
}

export async function createSessionChatAndMessageForApiRun(params: {
  session: typeof sessions.$inferInsert;
  chat: typeof chats.$inferInsert;
  message: typeof chatMessages.$inferInsert;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values(params.session);
    await tx.insert(chats).values(params.chat);
    await tx.insert(chatMessages).values(params.message);
  });
}

export async function recordApiRunEvent(params: {
  sessionId: string;
  chatId: string;
  userId: string;
  requestId: string | null;
  workflowRunId?: string | null;
  eventName: string;
  status:
    | "started"
    | "running"
    | "succeeded"
    | "failed"
    | "blocked"
    | "skipped"
    | "info";
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { emitSessionEvent } = await import("@/lib/observability/events");
  await emitSessionEvent({
    sessionId: params.sessionId,
    chatId: params.chatId,
    userId: params.userId,
    source: "system",
    actorType: "system",
    eventName: params.eventName,
    status: params.status,
    summary: params.summary,
    requestId: params.requestId,
    workflowRunId: params.workflowRunId ?? null,
    payload: params.payload ?? {},
  });
}

export async function countAgentApiRunsForWorkflow(
  workflowRunId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentApiRuns)
    .where(eq(agentApiRuns.workflowRunId, workflowRunId));

  return row?.count ?? 0;
}
