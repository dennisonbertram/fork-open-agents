import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  like,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  agentLoops,
  backgroundAgentEvents,
  backgroundAgentOutputs,
  backgroundAgentRuns,
  backgroundAgents,
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
import type { TriggerShapeInput } from "./trigger-shape-schema";
import {
  getExistingWebhookPublicIds,
  getWebhookPublicIdForUpdatedTrigger,
} from "./trigger-public-ids";
import { matchTriggersByIdentity } from "./trigger-upsert";
import {
  buildBackgroundAgentExecutionSnapshot,
  hashBackgroundAgentExecutionSnapshot,
} from "./execution-snapshot";
import {
  toPublicBackgroundAgentRun,
  type PublicBackgroundAgentRun,
} from "./public-run";

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
        checkCommand: normalizeOptionalText(input.checkCommand),
        composioToolkitSlugs: input.composioToolkitSlugs,
        githubActions: input.githubActions,
        writeScope: input.writeScope,
        requireCiGreenForMerge: input.requireCiGreenForMerge,
        modelId: input.modelId,
        runBudgetPerTarget: input.runBudgetPerTarget,
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
        ...(input.checkCommand !== undefined
          ? { checkCommand: normalizeOptionalText(input.checkCommand) }
          : {}),
        ...(input.composioToolkitSlugs !== undefined
          ? { composioToolkitSlugs: input.composioToolkitSlugs }
          : {}),
        ...(input.githubActions !== undefined
          ? { githubActions: input.githubActions }
          : {}),
        ...(input.writeScope !== undefined
          ? { writeScope: input.writeScope }
          : {}),
        ...(input.requireCiGreenForMerge !== undefined
          ? { requireCiGreenForMerge: input.requireCiGreenForMerge }
          : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.runBudgetPerTarget !== undefined
          ? { runBudgetPerTarget: input.runBudgetPerTarget }
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

      // The webhook-id reuse pool must contain ONLY ids from rows being
      // replaced (deleted above). A preserved row's id is still live under
      // the unique webhook_public_id index — handing it to a new row would
      // fail the insert and abort the whole agent edit.
      const existingWebhookPublicIds = getExistingWebhookPublicIds(
        existingTriggers.filter((row) => !preservedIds.has(row.id)),
      );

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
  const existingRun = await db.query.backgroundAgentRuns.findFirst({
    where: eq(backgroundAgentRuns.idempotencyKey, idempotencyKey),
  });
  if (existingRun) {
    return { run: existingRun, created: false };
  }

  const {
    resolveBackgroundAgentInferenceSnapshot,
    resolveBackgroundAgentSubagentInferenceSnapshot,
  } = await import("./inference-snapshot");
  const inference = await resolveBackgroundAgentInferenceSnapshot({
    userId: params.agent.userId,
    modelId: params.agent.modelId,
  });
  // #1158 follow-up: freeze the subagent selection with the run at
  // creation time, alongside the main model above, so a preference change
  // made while this run sits queued cannot change what a delegated `task`
  // worker uses when the run finally executes. Non-fatal by existing
  // convention for this field — a broken subagent preference (deleted
  // profile) must not block run creation.
  let subagentInference: Awaited<
    ReturnType<typeof resolveBackgroundAgentSubagentInferenceSnapshot>
  >;
  try {
    subagentInference = await resolveBackgroundAgentSubagentInferenceSnapshot(
      params.agent.userId,
    );
  } catch (error) {
    console.error(
      `[background-agents] failed to resolve subagent model preference for user "${params.agent.userId}" at run creation (non-fatal, delegated workers will use the main model):`,
      error,
    );
    subagentInference = undefined;
  }
  const executionSnapshot = buildBackgroundAgentExecutionSnapshot(
    params.agent,
    inference,
    subagentInference,
  );
  const definitionHash =
    hashBackgroundAgentExecutionSnapshot(executionSnapshot);

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
    executionSnapshot,
    definitionVersion: 1,
    definitionHash,
  };

  const inserted = await db.transaction(async (tx) => {
    const [winningRun] = await tx
      .insert(backgroundAgentRuns)
      .values(values)
      .onConflictDoNothing({ target: backgroundAgentRuns.idempotencyKey })
      .returning();
    if (!winningRun) return null;

    const [freezeEvent] = await tx
      .insert(backgroundAgentEvents)
      .values({
        id: nanoid(),
        runId: winningRun.id,
        agentId: winningRun.agentId,
        userId: winningRun.userId,
        eventName: "background-agent.snapshot.frozen",
        status: "succeeded",
        level: "info",
        summary: "Frozen background-agent execution definition.",
        requestId: params.requestId ?? null,
        payload: redactBackgroundAgentPayload({
          runId: winningRun.id,
          agentId: winningRun.agentId,
          definitionVersion: 1,
          definitionHash,
          snapshotSource: "frozen",
          requestId: params.requestId ?? null,
        }),
        redactionStatus: "passed",
        sequence: 1,
      })
      .returning();
    if (!freezeEvent) {
      throw new Error("Failed to persist frozen execution snapshot evidence");
    }
    return winningRun;
  });

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

const RECORD_EVENT_MAX_ATTEMPTS = 5;

export async function recordBackgroundAgentEvent(
  input: RecordEventInput,
): Promise<BackgroundAgentEvent> {
  // Assign a monotonic per-run sequence in application code: compute
  // max(sequence) for the run and add 1, using raw SQL coalesce so the first
  // event starts at 1. This computation is not atomic with the insert, so two
  // concurrent callers can compute the same next sequence — the UNIQUE index
  // on (run_id, sequence) then rejects the second writer's insert instead of
  // silently overwriting/dropping it (#743). We retry with a fresh max+1 on
  // that conflict rather than surface the drop to the caller.
  for (let attempt = 0; attempt < RECORD_EVENT_MAX_ATTEMPTS; attempt++) {
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
        // Resolve inside the INSERT statement so ON DELETE SET NULL cannot
        // race a preceding application read and leave a stale foreign key.
        agentId: sql<
          string | null
        >`(select agent_id from background_agent_runs where id = ${input.runId})`,
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
      .onConflictDoNothing({
        target: [backgroundAgentEvents.runId, backgroundAgentEvents.sequence],
      })
      .returning();

    if (event) {
      return event;
    }
    // Sequence collided with a concurrent writer for this run — retry with a
    // freshly computed max+1 on the next loop iteration.
  }

  throw new Error(
    `Failed to record background agent event for run ${input.runId} after ${RECORD_EVENT_MAX_ATTEMPTS} sequence-conflict retries`,
  );
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

const TERMINAL_RUN_STATUSES: BackgroundAgentRunStatus[] = [
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
];
const terminalRunStatusSet = new Set<BackgroundAgentRunStatus>(
  TERMINAL_RUN_STATUSES,
);

export async function updateBackgroundAgentRunStatus(params: {
  runId: string;
  status: BackgroundAgentRunStatus;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  outputUrl?: string | null;
  /**
   * Bypasses the terminal-status guard below. Only the stale-run sweeper
   * (dispatcher.ts) should pass this — it must be able to terminalize a run
   * that is legitimately stuck, even if the run already reached a terminal
   * status through a race with its own executor (#743).
   */
  force?: boolean;
  /**
   * Needed only to emit a background-agent.run.status_conflict event when a
   * non-forced transition is refused. Callers that don't have these on hand
   * simply won't get a conflict event recorded (best-effort observability).
   */
  agentId?: string | null;
  userId?: string;
  expectedStatuses?: BackgroundAgentRunStatus[];
  expectedWorkflowRunId?: string;
}): Promise<BackgroundAgentRun | null> {
  const now = new Date();
  const setValues = {
    status: params.status,
    ...(params.workflowRunId !== undefined
      ? { workflowRunId: params.workflowRunId }
      : {}),
    ...(params.sandboxName !== undefined
      ? { sandboxName: params.sandboxName }
      : {}),
    ...(params.errorKind !== undefined ? { errorKind: params.errorKind } : {}),
    ...(params.errorMessage !== undefined
      ? { errorMessage: params.errorMessage }
      : {}),
    ...(params.outputUrl !== undefined ? { outputUrl: params.outputUrl } : {}),
    ...(params.status === "running" ? { startedAt: now } : {}),
    ...(terminalRunStatusSet.has(params.status) ? { finishedAt: now } : {}),
    updatedAt: now,
  };

  const whereCondition = params.force
    ? eq(backgroundAgentRuns.id, params.runId)
    : and(
        eq(backgroundAgentRuns.id, params.runId),
        notInArray(backgroundAgentRuns.status, TERMINAL_RUN_STATUSES),
        params.expectedStatuses
          ? inArray(backgroundAgentRuns.status, params.expectedStatuses)
          : undefined,
        params.expectedWorkflowRunId
          ? eq(backgroundAgentRuns.workflowRunId, params.expectedWorkflowRunId)
          : undefined,
      );

  const [run] = await db
    .update(backgroundAgentRuns)
    .set(setValues)
    .where(whereCondition)
    .returning();

  if (run) {
    return run;
  }

  // The UPDATE matched no row. Distinguish "run doesn't exist" from "refused
  // a non-forced transition out of a terminal status" so we only emit a
  // status_conflict event for the latter.
  if (!params.force) {
    const existing = await getBackgroundAgentRun(params.runId);
    if (existing && terminalRunStatusSet.has(existing.status)) {
      if (params.userId) {
        await recordBackgroundAgentEvent({
          runId: params.runId,
          agentId: params.agentId ?? existing.agentId ?? null,
          userId: params.userId,
          eventName: "background-agent.run.status_conflict",
          status: "info",
          level: "warn",
          summary: `Refused non-forced transition from ${existing.status} to ${params.status}.`,
          payload: {
            runId: params.runId,
            from: existing.status,
            to: params.status,
          },
        });
      }
      return null;
    }
  }

  return null;
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
}): Promise<PublicBackgroundAgentRun[]> {
  const where = [
    eq(backgroundAgentRuns.userId, params.userId),
    params.repoOwner
      ? sql`lower(${backgroundAgentRuns.repoOwner}) = ${params.repoOwner.toLowerCase()}`
      : undefined,
    params.repoName
      ? sql`lower(${backgroundAgentRuns.repoName}) = ${params.repoName.toLowerCase()}`
      : undefined,
  ].filter(Boolean);

  const rows = await db.query.backgroundAgentRuns.findMany({
    where: and(...where),
    orderBy: [desc(backgroundAgentRuns.createdAt)],
    limit: Math.min(Math.max(params.limit ?? 50, 1), 200),
  });
  return rows.map(toPublicBackgroundAgentRun);
}

export async function listStaleBackgroundAgentRuns(params: {
  staleBefore: Date;
  limit?: number;
}): Promise<BackgroundAgentRun[]> {
  return db.query.backgroundAgentRuns.findMany({
    where: and(
      inArray(backgroundAgentRuns.status, ["queued", "running"]),
      sql`${backgroundAgentRuns.updatedAt} < ${params.staleBefore.toISOString()}::timestamp`,
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

/**
 * Uncapped fetch of this run's Composio-prefixed events (#798, Codex review
 * P2-1). listBackgroundAgentEvents above is a bounded newest-200 slice;
 * Composio resolution emits EARLY in a run, so on any run with more than
 * 200 total events, the composio events can fall off that slice entirely.
 * This query is scoped by runId first (same index as the capped query, via
 * `background_agent_events_run_created_idx`), so filtering further by
 * eventName is cheap — it never scans more than one run's events.
 */
export async function listBackgroundAgentComposioEvents(
  runId: string,
): Promise<BackgroundAgentEvent[]> {
  return db.query.backgroundAgentEvents.findMany({
    where: and(
      eq(backgroundAgentEvents.runId, runId),
      like(backgroundAgentEvents.eventName, "%.composio.%"),
    ),
    orderBy: [desc(backgroundAgentEvents.createdAt)],
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

/**
 * Counts runs this agent has created for the same (repo, prNumber) since a
 * given timestamp (#749). Backs the per-agent-per-PR run budget: the
 * dispatcher refuses to create additional runs once this count reaches the
 * agent's runBudgetPerTarget within a rolling 24h window.
 *
 * repoOwner/repoName are matched case-insensitively for consistency with the
 * rest of the matching/dispatch pipeline.
 */
export async function countRecentRunsForTarget(params: {
  agentId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  since: Date;
}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(backgroundAgentRuns)
    .where(
      and(
        eq(backgroundAgentRuns.agentId, params.agentId),
        eq(backgroundAgentRuns.prNumber, params.prNumber),
        sql`lower(${backgroundAgentRuns.repoOwner}) = ${params.repoOwner.toLowerCase()}`,
        sql`lower(${backgroundAgentRuns.repoName}) = ${params.repoName.toLowerCase()}`,
        sql`${backgroundAgentRuns.createdAt} > ${params.since.toISOString()}`,
      ),
    );

  return Number(row?.count ?? 0);
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

/**
 * Lists triggers bound to a loop (loopId set, agentId null).
 * Used by the M1-08 loop-detail route to include a trigger summary, and by
 * the #762 GET /api/agent-loops/[loopId]/triggers route (which additionally
 * humanizes `schedule` for display — see schedule-humanize.ts).
 * Returns a minimal projection — no secrets (webhookSecretHash) exposed.
 */
export async function listTriggersForLoop(
  loopId: string,
): Promise<
  Pick<
    BackgroundAgentTrigger,
    | "id"
    | "kind"
    | "status"
    | "conditions"
    | "schedule"
    | "nextRunAt"
    | "createdAt"
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
      nextRunAt: true,
      createdAt: true,
    },
  });
}

// ── Loop-bound trigger CRUD (#762) ───────────────────────────────────────────
//
// Rows are inserted with loopId set and agentId null — the DB CHECK
// num_nonnulls(agent_id, loop_id) = 1 (schema.ts) enforces this is the only
// valid shape for a loop-bound trigger. Route-level ownership (does this
// loop belong to the caller?) happens one layer up in the route handler via
// getOwnedAgentLoop; these store functions additionally scope every mutation
// to (triggerId, loopId) so a trigger id guessed/leaked from another loop can
// never be updated or deleted through this loop's routes.

export async function createLoopTrigger(params: {
  loopId: string;
  userId: string;
  input: TriggerShapeInput;
  now?: Date;
}): Promise<BackgroundAgentTrigger> {
  const now = params.now ?? new Date();
  const schedule = normalizeOptionalText(params.input.schedule);
  const [trigger] = await db
    .insert(backgroundAgentTriggers)
    .values({
      id: nanoid(),
      agentId: null,
      loopId: params.loopId,
      userId: params.userId,
      name: params.input.name,
      kind: params.input.kind,
      status: params.input.status,
      conditions: params.input.conditions,
      schedule,
      webhookPublicId: null,
      nextRunAt: seedNextRunAt({ kind: params.input.kind, schedule, now }),
    })
    .returning();

  if (!trigger) {
    throw new Error("Failed to create loop trigger");
  }

  return trigger;
}

export async function updateLoopTrigger(params: {
  loopId: string;
  triggerId: string;
  input: Partial<TriggerShapeInput>;
  now?: Date;
}): Promise<BackgroundAgentTrigger | null> {
  const now = params.now ?? new Date();
  const existing = await db.query.backgroundAgentTriggers.findFirst({
    where: and(
      eq(backgroundAgentTriggers.id, params.triggerId),
      eq(backgroundAgentTriggers.loopId, params.loopId),
    ),
  });
  if (!existing) {
    return null;
  }

  const nextKind = params.input.kind ?? existing.kind;
  const scheduleProvided = params.input.schedule !== undefined;
  const nextSchedule = scheduleProvided
    ? normalizeOptionalText(params.input.schedule)
    : existing.schedule;

  // Re-seed nextRunAt whenever the kind or schedule changes (matches the
  // agent-trigger replace-on-identity-change behavior in updateBackgroundAgent).
  // An unchanged schedule.cron trigger keeps its existing nextRunAt so an
  // in-flight due window isn't reset by an unrelated field edit (e.g. status).
  const scheduleChanged =
    (params.input.kind !== undefined && params.input.kind !== existing.kind) ||
    (scheduleProvided && nextSchedule !== existing.schedule);

  const [updated] = await db
    .update(backgroundAgentTriggers)
    .set({
      ...(params.input.name !== undefined ? { name: params.input.name } : {}),
      ...(params.input.kind !== undefined ? { kind: params.input.kind } : {}),
      ...(params.input.status !== undefined
        ? { status: params.input.status }
        : {}),
      ...(params.input.conditions !== undefined
        ? { conditions: params.input.conditions }
        : {}),
      ...(scheduleProvided ? { schedule: nextSchedule } : {}),
      ...(scheduleChanged
        ? {
            nextRunAt: seedNextRunAt({
              kind: nextKind,
              schedule: nextSchedule ?? null,
              now,
            }),
          }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(backgroundAgentTriggers.id, params.triggerId),
        eq(backgroundAgentTriggers.loopId, params.loopId),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function deleteLoopTrigger(params: {
  loopId: string;
  triggerId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(backgroundAgentTriggers)
    .where(
      and(
        eq(backgroundAgentTriggers.id, params.triggerId),
        eq(backgroundAgentTriggers.loopId, params.loopId),
      ),
    )
    .returning({ id: backgroundAgentTriggers.id });
  return deleted.length > 0;
}

export async function getOwnedLoopTrigger(params: {
  loopId: string;
  triggerId: string;
}): Promise<BackgroundAgentTrigger | null> {
  const trigger = await db.query.backgroundAgentTriggers.findFirst({
    where: and(
      eq(backgroundAgentTriggers.id, params.triggerId),
      eq(backgroundAgentTriggers.loopId, params.loopId),
    ),
  });
  return trigger ?? null;
}
