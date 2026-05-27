import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  backgroundAgentEvents,
  backgroundAgentOutputs,
  backgroundAgentRuns,
  backgroundAgents,
  backgroundAgentToolGrants,
  backgroundAgentTriggers,
  type BackgroundAgent,
  type BackgroundAgentEvent,
  type BackgroundAgentOutput,
  type BackgroundAgentRun,
  type BackgroundAgentTrigger,
  type NewBackgroundAgentEvent,
  type NewBackgroundAgentRun,
} from "@/lib/db/schema";
import { redactBackgroundAgentPayload } from "./redaction";
import { triggerMatchesEvent } from "./matching";
import {
  buildBackgroundRunIdempotencyKey,
  type BackgroundAgentRunStatus,
  type CreateBackgroundAgentInput,
  type NormalizedBackgroundTriggerEvent,
  type UpdateBackgroundAgentInput,
} from "./types";

export type BackgroundAgentWithTriggers = BackgroundAgent & {
  triggers: BackgroundAgentTrigger[];
};

export type BackgroundAgentRunWithAgent = BackgroundAgentRun & {
  agent: Pick<BackgroundAgent, "id" | "name" | "repoOwner" | "repoName"> | null;
};

type RecordEventInput = {
  runId: string;
  agentId?: string | null;
  userId: string;
  eventName: string;
  status: NewBackgroundAgentEvent["status"];
  level?: NewBackgroundAgentEvent["level"];
  summary?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  payload?: unknown;
};

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function createBackgroundAgent(
  userId: string,
  input: CreateBackgroundAgentInput,
): Promise<BackgroundAgentWithTriggers> {
  return db.transaction(async (tx) => {
    const [agent] = await tx
      .insert(backgroundAgents)
      .values({
        id: nanoid(),
        userId,
        name: input.name,
        description: normalizeOptionalText(input.description),
        status: input.status,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        instructions: input.instructions,
        permissions: input.permissions,
        outputMode: input.outputMode,
        checkCommand: normalizeOptionalText(input.checkCommand),
      })
      .returning();

    if (!agent) {
      throw new Error("Failed to create background agent");
    }

    const triggers = await tx
      .insert(backgroundAgentTriggers)
      .values(
        input.triggers.map((trigger) => ({
          id: nanoid(),
          agentId: agent.id,
          userId,
          name: trigger.name,
          kind: trigger.kind,
          status: trigger.status,
          conditions: trigger.conditions,
          schedule: normalizeOptionalText(trigger.schedule),
          webhookPublicId: trigger.kind === "webhook.error" ? nanoid(16) : null,
        })),
      )
      .returning();

    return { ...agent, triggers };
  });
}

export async function updateBackgroundAgent(
  userId: string,
  agentId: string,
  input: UpdateBackgroundAgentInput,
): Promise<BackgroundAgentWithTriggers | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.backgroundAgents.findFirst({
      where: and(
        eq(backgroundAgents.id, agentId),
        eq(backgroundAgents.userId, userId),
      ),
    });
    if (!existing) {
      return null;
    }

    const [agent] = await tx
      .update(backgroundAgents)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: normalizeOptionalText(input.description) }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.repoOwner !== undefined
          ? { repoOwner: input.repoOwner }
          : {}),
        ...(input.repoName !== undefined ? { repoName: input.repoName } : {}),
        ...(input.instructions !== undefined
          ? { instructions: input.instructions }
          : {}),
        ...(input.permissions !== undefined
          ? { permissions: input.permissions }
          : {}),
        ...(input.outputMode !== undefined
          ? { outputMode: input.outputMode }
          : {}),
        ...(input.checkCommand !== undefined
          ? { checkCommand: normalizeOptionalText(input.checkCommand) }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(backgroundAgents.id, agentId),
          eq(backgroundAgents.userId, userId),
        ),
      )
      .returning();

    if (!agent) {
      return null;
    }

    if (input.triggers !== undefined) {
      await tx
        .delete(backgroundAgentTriggers)
        .where(eq(backgroundAgentTriggers.agentId, agent.id));
      await tx.insert(backgroundAgentTriggers).values(
        input.triggers.map((trigger) => ({
          id: nanoid(),
          agentId: agent.id,
          userId,
          name: trigger.name,
          kind: trigger.kind,
          status: trigger.status,
          conditions: trigger.conditions,
          schedule: normalizeOptionalText(trigger.schedule),
          webhookPublicId: trigger.kind === "webhook.error" ? nanoid(16) : null,
        })),
      );
    }

    const triggers = await tx.query.backgroundAgentTriggers.findMany({
      where: eq(backgroundAgentTriggers.agentId, agent.id),
      orderBy: [desc(backgroundAgentTriggers.createdAt)],
    });

    return { ...agent, triggers };
  });
}

export async function deleteBackgroundAgent(
  userId: string,
  agentId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(backgroundAgents)
    .where(
      and(
        eq(backgroundAgents.id, agentId),
        eq(backgroundAgents.userId, userId),
      ),
    )
    .returning({ id: backgroundAgents.id });
  return deleted.length > 0;
}

export async function listBackgroundAgents(
  userId: string,
): Promise<BackgroundAgentWithTriggers[]> {
  const [agents, triggers] = await Promise.all([
    db.query.backgroundAgents.findMany({
      where: eq(backgroundAgents.userId, userId),
      orderBy: [desc(backgroundAgents.updatedAt)],
    }),
    db.query.backgroundAgentTriggers.findMany({
      where: eq(backgroundAgentTriggers.userId, userId),
      orderBy: [desc(backgroundAgentTriggers.createdAt)],
    }),
  ]);

  const triggersByAgent = new Map<string, BackgroundAgentTrigger[]>();
  for (const trigger of triggers) {
    const current = triggersByAgent.get(trigger.agentId) ?? [];
    current.push(trigger);
    triggersByAgent.set(trigger.agentId, current);
  }

  return agents.map((agent) => ({
    ...agent,
    triggers: triggersByAgent.get(agent.id) ?? [],
  }));
}

export async function listRepoBackgroundAgents(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<BackgroundAgentWithTriggers[]> {
  const all = await listBackgroundAgents(params.userId);
  return all.filter(
    (agent) =>
      agent.repoOwner.toLowerCase() === params.repoOwner.toLowerCase() &&
      agent.repoName.toLowerCase() === params.repoName.toLowerCase(),
  );
}

export async function listMatchingTriggersForEvent(
  event: NormalizedBackgroundTriggerEvent,
): Promise<Array<{ agent: BackgroundAgent; trigger: BackgroundAgentTrigger }>> {
  const triggers = await db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .innerJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .where(
      and(
        eq(backgroundAgentTriggers.kind, event.kind),
        eq(backgroundAgentTriggers.status, "enabled"),
        eq(backgroundAgents.status, "enabled"),
        sql`lower(${backgroundAgents.repoOwner}) = ${event.repoOwner.toLowerCase()}`,
        sql`lower(${backgroundAgents.repoName}) = ${event.repoName.toLowerCase()}`,
      ),
    );

  return triggers.filter(({ trigger }) => triggerMatchesEvent(trigger, event));
}

export { triggerMatchesEvent };

export async function createRunForTrigger(params: {
  agent: BackgroundAgent;
  trigger: BackgroundAgentTrigger;
  event: NormalizedBackgroundTriggerEvent;
  requestId?: string | null;
}): Promise<{ run: BackgroundAgentRun; created: boolean }> {
  const idempotencyKey = buildBackgroundRunIdempotencyKey({
    agentId: params.agent.id,
    triggerId: params.trigger.id,
    event: params.event,
  });

  const values: NewBackgroundAgentRun = {
    id: nanoid(),
    agentId: params.agent.id,
    triggerId: params.trigger.id,
    userId: params.agent.userId,
    status: "queued",
    source: params.event.source,
    triggerKind: params.event.kind,
    externalId: params.event.externalId,
    idempotencyKey,
    repoOwner: params.event.repoOwner,
    repoName: params.event.repoName,
    ref: params.event.ref ?? null,
    sha: params.event.sha ?? null,
    branch: params.event.branch ?? null,
    prNumber: params.event.prNumber ?? null,
    issueNumber: params.event.issueNumber ?? null,
    deploymentUrl: params.event.deploymentUrl ?? null,
    outputKind: params.agent.outputMode,
    payloadSummary: {
      title: params.event.title,
      url: params.event.url,
      actor: params.event.actor,
      action: params.event.action,
      environment: params.event.environment,
      severity: params.event.severity,
      message: params.event.message,
    },
    requestId: params.requestId ?? null,
  };

  const [inserted] = await db
    .insert(backgroundAgentRuns)
    .values(values)
    .onConflictDoNothing({ target: backgroundAgentRuns.idempotencyKey })
    .returning();

  if (inserted) {
    await recordBackgroundAgentEvent({
      runId: inserted.id,
      agentId: params.agent.id,
      userId: params.agent.userId,
      eventName: "background-agent.run.created",
      status: "started",
      summary: `Queued ${params.agent.name}.`,
      requestId: params.requestId ?? null,
      payload: {
        source: params.event.source,
        triggerKind: params.event.kind,
        externalId: params.event.externalId,
        idempotencyKey,
      },
    });
    return { run: inserted, created: true };
  }

  const existing = await db.query.backgroundAgentRuns.findFirst({
    where: eq(backgroundAgentRuns.idempotencyKey, idempotencyKey),
  });
  if (!existing) {
    throw new Error("Failed to create or load background run");
  }

  return { run: existing, created: false };
}

export async function recordBackgroundAgentEvent(
  input: RecordEventInput,
): Promise<BackgroundAgentEvent> {
  const [event] = await db
    .insert(backgroundAgentEvents)
    .values({
      id: nanoid(),
      runId: input.runId,
      agentId: input.agentId ?? null,
      userId: input.userId,
      eventName: input.eventName,
      status: input.status,
      level: input.level ?? "info",
      summary: input.summary ?? null,
      requestId: input.requestId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      sandboxName: input.sandboxName ?? null,
      errorKind: input.errorKind ?? null,
      payload: redactBackgroundAgentPayload(input.payload),
      redactionStatus: "passed",
    })
    .returning();

  if (!event) {
    throw new Error("Failed to record background agent event");
  }

  return event;
}

export async function updateBackgroundAgentRunStatus(params: {
  runId: string;
  status: BackgroundAgentRunStatus;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
}): Promise<BackgroundAgentRun | null> {
  const terminalStatuses = new Set<BackgroundAgentRunStatus>([
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
  ]);
  const now = new Date();
  const [run] = await db
    .update(backgroundAgentRuns)
    .set({
      status: params.status,
      ...(params.workflowRunId !== undefined
        ? { workflowRunId: params.workflowRunId }
        : {}),
      ...(params.sandboxName !== undefined
        ? { sandboxName: params.sandboxName }
        : {}),
      ...(params.errorKind !== undefined
        ? { errorKind: params.errorKind }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: params.errorMessage }
        : {}),
      ...(params.status === "running" ? { startedAt: now } : {}),
      ...(terminalStatuses.has(params.status) ? { finishedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(backgroundAgentRuns.id, params.runId))
    .returning();

  return run ?? null;
}

export async function getBackgroundAgentRun(
  runId: string,
): Promise<BackgroundAgentRun | undefined> {
  return db.query.backgroundAgentRuns.findFirst({
    where: eq(backgroundAgentRuns.id, runId),
  });
}

export async function getOwnedBackgroundAgentRun(params: {
  userId: string;
  runId: string;
}): Promise<BackgroundAgentRun | undefined> {
  return db.query.backgroundAgentRuns.findFirst({
    where: and(
      eq(backgroundAgentRuns.id, params.runId),
      eq(backgroundAgentRuns.userId, params.userId),
    ),
  });
}

export async function listBackgroundAgentRuns(params: {
  userId: string;
  repoOwner?: string;
  repoName?: string;
  limit?: number;
}): Promise<BackgroundAgentRun[]> {
  const where = [
    eq(backgroundAgentRuns.userId, params.userId),
    params.repoOwner
      ? sql`lower(${backgroundAgentRuns.repoOwner}) = ${params.repoOwner.toLowerCase()}`
      : undefined,
    params.repoName
      ? sql`lower(${backgroundAgentRuns.repoName}) = ${params.repoName.toLowerCase()}`
      : undefined,
  ].filter(Boolean);

  return db.query.backgroundAgentRuns.findMany({
    where: and(...where),
    orderBy: [desc(backgroundAgentRuns.createdAt)],
    limit: Math.min(Math.max(params.limit ?? 50, 1), 200),
  });
}

export async function listBackgroundAgentEvents(
  runId: string,
): Promise<BackgroundAgentEvent[]> {
  return db.query.backgroundAgentEvents.findMany({
    where: eq(backgroundAgentEvents.runId, runId),
    orderBy: [desc(backgroundAgentEvents.createdAt)],
    limit: 200,
  });
}

export async function listBackgroundAgentOutputs(
  runId: string,
): Promise<BackgroundAgentOutput[]> {
  return db.query.backgroundAgentOutputs.findMany({
    where: eq(backgroundAgentOutputs.runId, runId),
    orderBy: [desc(backgroundAgentOutputs.createdAt)],
    limit: 50,
  });
}

export async function listEnabledScheduleTriggers(): Promise<
  Array<{ agent: BackgroundAgent; trigger: BackgroundAgentTrigger }>
> {
  return db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .innerJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .where(
      and(
        eq(backgroundAgentTriggers.kind, "schedule.cron"),
        eq(backgroundAgentTriggers.status, "enabled"),
        eq(backgroundAgents.status, "enabled"),
      ),
    );
}

export async function getWebhookTriggerByPublicId(
  webhookPublicId: string,
): Promise<{ agent: BackgroundAgent; trigger: BackgroundAgentTrigger } | null> {
  const [row] = await db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .innerJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .where(eq(backgroundAgentTriggers.webhookPublicId, webhookPublicId))
    .limit(1);

  return row ?? null;
}

export async function listAgentsByIds(
  agentIds: string[],
): Promise<BackgroundAgent[]> {
  if (agentIds.length === 0) {
    return [];
  }
  return db.query.backgroundAgents.findMany({
    where: inArray(backgroundAgents.id, agentIds),
  });
}

export { backgroundAgentToolGrants };
