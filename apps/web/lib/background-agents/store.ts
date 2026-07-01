import "server-only";

import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  agentLoops,
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
  type NewBackgroundAgentOutput,
  type NewBackgroundAgentRun,
} from "@/lib/db/schema";
import { redactBackgroundAgentPayload } from "./redaction";
import { triggerMatchesEvent } from "./matching";
import { computeNextRuns } from "./schedule-presets";
import {
  buildBackgroundRunIdempotencyKey,
  type BackgroundAgentRunStatus,
  type CreateBackgroundAgentInput,
  type NormalizedBackgroundTriggerEvent,
  type UpdateBackgroundAgentInput,
} from "./types";
import {
  getExistingWebhookPublicIds,
  getWebhookPublicIdForUpdatedTrigger,
} from "./trigger-public-ids";
import { matchTriggersByIdentity } from "./trigger-upsert";

/**
 * Seeds nextRunAt for a schedule.cron trigger at creation/replacement time.
 * Returns null for non-schedule triggers or invalid/missing schedules
 * (computeNextRuns already returns [] for those — see schedule-presets.ts).
 */
function seedNextRunAt(params: {
  kind: string;
  schedule: string | null;
  now: Date;
}): Date | null {
  if (params.kind !== "schedule.cron") {
    return null;
  }
  return computeNextRuns(params.schedule, params.now, 1)[0] ?? null;
}

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

type RecordOutputInput = {
  runId: string;
  userId: string;
  kind: NewBackgroundAgentOutput["kind"];
  status: NewBackgroundAgentOutput["status"];
  url?: string | null;
  prNumber?: number | null;
  payload?: unknown;
};

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function createBackgroundAgent(
  userId: string,
  input: CreateBackgroundAgentInput,
  options?: { now?: Date },
): Promise<BackgroundAgentWithTriggers> {
  const now = options?.now ?? new Date();
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
        composioToolkitSlugs: input.composioToolkitSlugs,
      })
      .returning();

    if (!agent) {
      throw new Error("Failed to create background agent");
    }

    const triggers = await tx
      .insert(backgroundAgentTriggers)
      .values(
        input.triggers.map((trigger) => {
          const schedule = normalizeOptionalText(trigger.schedule);
          return {
            id: nanoid(),
            agentId: agent.id,
            userId,
            name: trigger.name,
            kind: trigger.kind,
            status: trigger.status,
            conditions: trigger.conditions,
            schedule,
            webhookPublicId:
              trigger.kind === "webhook.error" ? nanoid(16) : null,
            nextRunAt: seedNextRunAt({ kind: trigger.kind, schedule, now }),
          };
        }),
      )
      .returning();

    return { ...agent, triggers };
  });
}

export async function updateBackgroundAgent(
  userId: string,
  agentId: string,
  input: UpdateBackgroundAgentInput,
  options?: { now?: Date },
): Promise<BackgroundAgentWithTriggers | null> {
  const now = options?.now ?? new Date();
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
        ...(input.composioToolkitSlugs !== undefined
          ? { composioToolkitSlugs: input.composioToolkitSlugs }
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
      const existingTriggers = await tx.query.backgroundAgentTriggers.findMany({
        where: eq(backgroundAgentTriggers.agentId, agent.id),
        orderBy: [desc(backgroundAgentTriggers.createdAt)],
      });
      const existingWebhookPublicIds =
        getExistingWebhookPublicIds(existingTriggers);

      // Upsert-by-identity: a trigger whose kind/schedule/conditions/name are
      // unchanged is PRESERVED (same row id, lastRunAt, nextRunAt,
      // lastSkipReason, webhookPublicId) instead of being deleted and
      // recreated. This keeps run idempotency identity stable across edits
      // and prevents a no-op edit from silently resetting a working schedule.
      const matches = matchTriggersByIdentity({
        incoming: input.triggers.map((trigger) => ({
          name: trigger.name,
          kind: trigger.kind,
          conditions: trigger.conditions,
          schedule: trigger.schedule,
        })),
        existing: existingTriggers,
      });

      const preservedIds = new Set<string>();
      for (const [index, trigger] of input.triggers.entries()) {
        const matched = matches[index];
        if (matched) {
          preservedIds.add(matched.id);
          await tx
            .update(backgroundAgentTriggers)
            .set({
              status: trigger.status,
              updatedAt: new Date(),
            })
            .where(eq(backgroundAgentTriggers.id, matched.id));
        }
      }

      const staleTriggerIds = existingTriggers
        .map((row) => row.id)
        .filter((id) => !preservedIds.has(id));
      if (staleTriggerIds.length > 0) {
        await tx
          .delete(backgroundAgentTriggers)
          .where(inArray(backgroundAgentTriggers.id, staleTriggerIds));
      }

      const newTriggerValues = input.triggers
        .map((trigger, index) => ({ trigger, matched: matches[index] }))
        .filter(({ matched }) => !matched)
        .map(({ trigger }) => {
          const schedule = normalizeOptionalText(trigger.schedule);
          return {
            id: nanoid(),
            agentId: agent.id,
            userId,
            name: trigger.name,
            kind: trigger.kind,
            status: trigger.status,
            conditions: trigger.conditions,
            schedule,
            webhookPublicId: getWebhookPublicIdForUpdatedTrigger({
              trigger,
              existingWebhookPublicIds,
            }),
            nextRunAt: seedNextRunAt({ kind: trigger.kind, schedule, now }),
            // A replaced/new trigger identity starts fresh — it must not
            // inherit lastRunAt/lastSkipReason from the row it replaced.
            lastRunAt: null,
            lastSkipReason: null,
          };
        });
      if (newTriggerValues.length > 0) {
        await tx.insert(backgroundAgentTriggers).values(newTriggerValues);
      }
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
    // Loop-bound triggers (loopId set, agentId null) are skipped here —
    // they are not associated with a specific background agent.
    if (!trigger.agentId) continue;
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

export async function getOwnedBackgroundAgentWithTriggers(params: {
  userId: string;
  agentId: string;
}): Promise<BackgroundAgentWithTriggers | null> {
  const agent = await db.query.backgroundAgents.findFirst({
    where: and(
      eq(backgroundAgents.id, params.agentId),
      eq(backgroundAgents.userId, params.userId),
    ),
  });
  if (!agent) {
    return null;
  }

  const triggers = await db.query.backgroundAgentTriggers.findMany({
    where: eq(backgroundAgentTriggers.agentId, agent.id),
    orderBy: [desc(backgroundAgentTriggers.createdAt)],
  });

  return { ...agent, triggers };
}

export async function listMatchingTriggersForEvent(
  event: NormalizedBackgroundTriggerEvent,
): Promise<
  Array<{ agent: BackgroundAgent | null; trigger: BackgroundAgentTrigger }>
> {
  const triggers = await db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .leftJoin(agentLoops, eq(agentLoops.id, backgroundAgentTriggers.loopId))
    .where(
      and(
        eq(backgroundAgentTriggers.kind, event.kind),
        eq(backgroundAgentTriggers.status, "enabled"),
        or(
          and(
            isNotNull(backgroundAgentTriggers.agentId),
            eq(backgroundAgents.status, "enabled"),
            sql`lower(${backgroundAgents.repoOwner}) = ${event.repoOwner.toLowerCase()}`,
            sql`lower(${backgroundAgents.repoName}) = ${event.repoName.toLowerCase()}`,
          ),
          and(
            isNotNull(backgroundAgentTriggers.loopId),
            eq(agentLoops.status, "active"),
            sql`lower(${agentLoops.repoOwner}) = ${event.repoOwner.toLowerCase()}`,
            sql`lower(${agentLoops.repoName}) = ${event.repoName.toLowerCase()}`,
          ),
        ),
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
  // Assign a monotonic per-run sequence in application code.
  // We compute max(sequence) for the run and add 1, using raw SQL
  // coalesce so the first event starts at 1.
  const [seqRow] = await db
    .select({
      nextSeq: sql<number>`coalesce(max(${backgroundAgentEvents.sequence}), 0) + 1`,
    })
    .from(backgroundAgentEvents)
    .where(eq(backgroundAgentEvents.runId, input.runId));

  const sequence = Number(seqRow?.nextSeq ?? 1);

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
      sequence,
    })
    .returning();

  if (!event) {
    throw new Error("Failed to record background agent event");
  }

  return event;
}

export async function recordBackgroundAgentOutput(
  input: RecordOutputInput,
): Promise<BackgroundAgentOutput> {
  const [output] = await db
    .insert(backgroundAgentOutputs)
    .values({
      id: nanoid(),
      runId: input.runId,
      userId: input.userId,
      kind: input.kind,
      status: input.status,
      url: input.url ?? null,
      prNumber: input.prNumber ?? null,
      payload: redactBackgroundAgentPayload(input.payload),
    })
    .returning();

  if (!output) {
    throw new Error("Failed to record background agent output");
  }

  return output;
}

export async function updateBackgroundAgentRunStatus(params: {
  runId: string;
  status: BackgroundAgentRunStatus;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
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
      ...(params.outputUrl !== undefined
        ? { outputUrl: params.outputUrl }
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

export async function getBackgroundAgentRunWithAgent(runId: string): Promise<
  | {
      run: BackgroundAgentRun;
      agent: BackgroundAgent | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      run: backgroundAgentRuns,
      agent: backgroundAgents,
    })
    .from(backgroundAgentRuns)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentRuns.agentId),
    )
    .where(eq(backgroundAgentRuns.id, runId))
    .limit(1);

  return row;
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

export async function getOwnedBackgroundAgentRunWithAgent(params: {
  userId: string;
  runId: string;
}): Promise<
  | {
      run: BackgroundAgentRun;
      agent: BackgroundAgent | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      run: backgroundAgentRuns,
      agent: backgroundAgents,
    })
    .from(backgroundAgentRuns)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentRuns.agentId),
    )
    .where(
      and(
        eq(backgroundAgentRuns.id, params.runId),
        eq(backgroundAgentRuns.userId, params.userId),
      ),
    )
    .limit(1);

  return row;
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

export async function listStaleBackgroundAgentRuns(params: {
  staleBefore: Date;
  limit?: number;
}): Promise<BackgroundAgentRun[]> {
  return db.query.backgroundAgentRuns.findMany({
    where: and(
      inArray(backgroundAgentRuns.status, ["queued", "running"]),
      sql`${backgroundAgentRuns.updatedAt} < ${params.staleBefore}`,
    ),
    orderBy: [backgroundAgentRuns.updatedAt],
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

export async function listBackgroundAgentEventsAfter(
  runId: string,
  afterSequence: number,
): Promise<BackgroundAgentEvent[]> {
  const rows = await db
    .select()
    .from(backgroundAgentEvents)
    .where(
      and(
        eq(backgroundAgentEvents.runId, runId),
        sql`${backgroundAgentEvents.sequence} > ${afterSequence}`,
      ),
    )
    .orderBy(sql`${backgroundAgentEvents.sequence} asc`)
    .limit(200);

  return rows;
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
  Array<{ agent: BackgroundAgent | null; trigger: BackgroundAgentTrigger }>
> {
  return db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .leftJoin(agentLoops, eq(agentLoops.id, backgroundAgentTriggers.loopId))
    .where(
      and(
        eq(backgroundAgentTriggers.kind, "schedule.cron"),
        eq(backgroundAgentTriggers.status, "enabled"),
        or(
          and(
            isNotNull(backgroundAgentTriggers.agentId),
            eq(backgroundAgents.status, "enabled"),
          ),
          and(
            isNotNull(backgroundAgentTriggers.loopId),
            eq(agentLoops.status, "active"),
          ),
        ),
      ),
    );
}

export async function getWebhookTriggerByPublicId(
  webhookPublicId: string,
): Promise<{
  agent: BackgroundAgent | null;
  trigger: BackgroundAgentTrigger;
} | null> {
  const [row] = await db
    .select({
      trigger: backgroundAgentTriggers,
      agent: backgroundAgents,
    })
    .from(backgroundAgentTriggers)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentTriggers.agentId),
    )
    .leftJoin(agentLoops, eq(agentLoops.id, backgroundAgentTriggers.loopId))
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

export async function advanceTriggerScheduleState(params: {
  triggerId: string;
  lastRunAt: Date;
  nextRunAt: Date | null;
}): Promise<void> {
  await db
    .update(backgroundAgentTriggers)
    .set({
      lastRunAt: params.lastRunAt,
      nextRunAt: params.nextRunAt,
      lastSkipReason: null,
      updatedAt: new Date(),
    })
    .where(eq(backgroundAgentTriggers.id, params.triggerId));
}

/**
 * Seeds nextRunAt for a legacy schedule trigger row created before #750
 * (nextRunAt was never set at creation back then). Unlike
 * advanceTriggerScheduleState this does NOT touch lastRunAt/lastSkipReason —
 * the trigger has not fired; it is only being given a real due time so the
 * due-window dispatch can reach it.
 */
export async function seedTriggerNextRunAt(params: {
  triggerId: string;
  nextRunAt: Date | null;
}): Promise<void> {
  await db
    .update(backgroundAgentTriggers)
    .set({
      nextRunAt: params.nextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(backgroundAgentTriggers.id, params.triggerId));
}

export async function recordTriggerSkipReason(params: {
  triggerId: string;
  skipReason: string;
}): Promise<void> {
  await db
    .update(backgroundAgentTriggers)
    .set({
      lastSkipReason: params.skipReason,
      updatedAt: new Date(),
    })
    .where(eq(backgroundAgentTriggers.id, params.triggerId));
}

export { backgroundAgentToolGrants };

/**
 * Returns all enabled Composio tool grants for a given background agent.
 * An enabled grant means the agent is authorized to use the linked Composio
 * profile for that role/phase combination.
 *
 * Used by the executor to gate Composio tool resolution: if no enabled grants
 * exist, the agent gets no Composio tools (pre-Phase-5 behavior).
 */
export async function listEnabledToolGrantsForAgent(
  agentId: string,
): Promise<
  Array<
    Pick<
      typeof backgroundAgentToolGrants.$inferSelect,
      | "id"
      | "agentId"
      | "userId"
      | "provider"
      | "profileId"
      | "agentRole"
      | "phase"
      | "status"
    >
  >
> {
  return db.query.backgroundAgentToolGrants.findMany({
    where: and(
      eq(backgroundAgentToolGrants.agentId, agentId),
      eq(backgroundAgentToolGrants.status, "enabled"),
    ),
    columns: {
      id: true,
      agentId: true,
      userId: true,
      provider: true,
      profileId: true,
      agentRole: true,
      phase: true,
      status: true,
    },
  });
}

/**
 * Lists triggers bound to a loop (loopId set, agentId null).
 * Used by the M1-08 loop-detail route to include a trigger summary.
 * Returns a minimal projection — no schedule/conditions secrets exposed.
 */
export async function listTriggersForLoop(
  loopId: string,
): Promise<
  Pick<
    BackgroundAgentTrigger,
    "id" | "kind" | "status" | "conditions" | "schedule" | "createdAt"
  >[]
> {
  return db.query.backgroundAgentTriggers.findMany({
    where: eq(backgroundAgentTriggers.loopId, loopId),
    orderBy: [desc(backgroundAgentTriggers.createdAt)],
    columns: {
      id: true,
      kind: true,
      status: true,
      conditions: true,
      schedule: true,
      createdAt: true,
    },
  });
}
