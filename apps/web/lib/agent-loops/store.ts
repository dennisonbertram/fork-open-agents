import "server-only";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  agentLoopEvents,
  agentLoopRuns,
  agentLoops,
  agentLoopStepRuns,
  type AgentLoop,
  type AgentLoopEvent,
  type AgentLoopRun,
  type AgentLoopStepRun,
  type NewAgentLoopEvent,
  type NewAgentLoopRun,
  type NewAgentLoopStepRun,
} from "@/lib/db/schema";
import { redactBackgroundAgentPayload } from "@/lib/background-agents/redaction";
import { RunControlError } from "./run-controls-error";
import type { LoopValidationError } from "./types";
import { validateLoopDefinition } from "./validation";

// ── Public types ───────────────────────────────────────────────────────────────

export type AgentLoopRunWithLoop = {
  run: AgentLoopRun;
  loop: AgentLoop;
};

/**
 * Result type for createAgentLoop and updateAgentLoop (M1-02 validation gate).
 *
 * - { ok: true; loop: AgentLoop } — validation passed and DB write succeeded.
 * - { ok: false; errors: LoopValidationError[] } — definition is invalid; no DB write occurred.
 *
 * The M1-08 API routes translate errors[] into a 422 response with the
 * structured errors array in the body.
 */
export type AgentLoopWriteResult =
  | { ok: true; loop: AgentLoop }
  | { ok: false; errors: LoopValidationError[] };

/**
 * Result type for updateAgentLoop.
 *
 * Extends AgentLoopWriteResult with a null case when the loop is not found
 * (ownership miss or missing record — same as before, returns null).
 */
export type AgentLoopUpdateResult =
  | { ok: true; loop: AgentLoop | null }
  | { ok: false; errors: LoopValidationError[] };

export type CreateAgentLoopInput = {
  name: string;
  description?: string | null;
  repoOwner: string;
  repoName: string;
  /** { nodes: LoopNode[], edges: LoopEdge[] } — validated on write in M1-02 */
  definition: Record<string, unknown>;
  status?: AgentLoop["status"];
  guardrails?: Record<string, unknown> | null;
  permissions?: Record<string, unknown>;
};

export type UpdateAgentLoopInput = Partial<
  Pick<
    AgentLoop,
    | "name"
    | "description"
    | "status"
    | "guardrails"
    | "permissions"
    | "definition"
  >
>;

export type CreateAgentLoopRunInput = {
  loopId: string;
  userId: string;
  definitionSnapshot: Record<string, unknown>;
  source: NewAgentLoopRun["source"];
  idempotencyKey: string;
  triggerId?: string | null;
  requestId?: string | null;
};

export type CreateAgentLoopStepRunInput = {
  loopRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt?: number;
  stepInput?: Record<string, unknown> | null;
};

export type UpdateAgentLoopStepRunInput = {
  stepRunId: string;
  status?: NewAgentLoopStepRun["status"];
  stepOutput?: Record<string, unknown> | null;
  sandboxName?: string | null;
  workflowRunId?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
};

export type RecordAgentLoopEventInput = {
  loopRunId: string;
  stepRunId?: string | null;
  nodeId?: string | null;
  eventName: string;
  status: NewAgentLoopEvent["status"];
  level?: NewAgentLoopEvent["level"];
  summary?: string | null;
  payload?: unknown;
  requestId?: string | null;
  workflowRunId?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// ── agentLoops CRUD ───────────────────────────────────────────────────────────

export async function createAgentLoop(
  userId: string,
  input: CreateAgentLoopInput,
): Promise<AgentLoopWriteResult> {
  // M1-02: validate the definition before persisting
  const validation = validateLoopDefinition(input.definition);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const [loop] = await db
    .insert(agentLoops)
    .values({
      id: nanoid(),
      userId,
      name: input.name,
      description: normalizeOptionalText(input.description),
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      definition: input.definition,
      status: input.status ?? "draft",
      guardrails: input.guardrails ?? null,
      permissions: input.permissions ?? {},
    })
    .returning();

  if (!loop) {
    throw new Error("Failed to create agent loop");
  }

  return { ok: true, loop };
}

export async function updateAgentLoop(
  userId: string,
  loopId: string,
  input: UpdateAgentLoopInput,
): Promise<AgentLoopUpdateResult> {
  // M1-02: validate the definition if it is being updated
  if (input.definition !== undefined) {
    const validation = validateLoopDefinition(input.definition);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }
  }

  const txResult = await db.transaction(async (tx) => {
    const existing = await tx.query.agentLoops.findFirst({
      where: and(eq(agentLoops.id, loopId), eq(agentLoops.userId, userId)),
    });
    if (!existing) {
      return null;
    }

    const [updated] = await tx
      .update(agentLoops)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: normalizeOptionalText(input.description) }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.definition !== undefined
          ? { definition: input.definition }
          : {}),
        ...(input.guardrails !== undefined
          ? { guardrails: input.guardrails }
          : {}),
        ...(input.permissions !== undefined
          ? { permissions: input.permissions }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agentLoops.id, loopId), eq(agentLoops.userId, userId)))
      .returning();

    return updated ?? null;
  });

  return { ok: true, loop: txResult };
}

export async function deleteAgentLoop(
  userId: string,
  loopId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(agentLoops)
    .where(and(eq(agentLoops.id, loopId), eq(agentLoops.userId, userId)))
    .returning({ id: agentLoops.id });
  return deleted.length > 0;
}

export async function listAgentLoops(
  userId: string,
  filter?: { repoOwner: string; repoName: string } | undefined,
): Promise<AgentLoop[]> {
  return db.query.agentLoops.findMany({
    where: filter
      ? and(
          eq(agentLoops.userId, userId),
          eq(agentLoops.repoOwner, filter.repoOwner),
          eq(agentLoops.repoName, filter.repoName),
        )
      : eq(agentLoops.userId, userId),
    orderBy: [desc(agentLoops.updatedAt)],
  });
}

/**
 * Lists step runs for a loop run, ordered by createdAt ascending.
 * Used by the M1-08 poll endpoint to populate the run timeline (oldest→newest).
 */
export async function listStepRunsForRun(
  loopRunId: string,
): Promise<AgentLoopStepRun[]> {
  return db.query.agentLoopStepRuns.findMany({
    where: eq(agentLoopStepRuns.loopRunId, loopRunId),
    orderBy: [asc(agentLoopStepRuns.createdAt)],
  });
}

export async function getOwnedAgentLoop(params: {
  userId: string;
  loopId: string;
}): Promise<AgentLoop | null> {
  const loop = await db.query.agentLoops.findFirst({
    where: and(
      eq(agentLoops.id, params.loopId),
      eq(agentLoops.userId, params.userId),
    ),
  });
  return loop ?? null;
}

/**
 * Looks up a loop by its id WITHOUT ownership scoping.
 * Used by the dispatcher to load a loop-bound trigger's target loop where
 * the trigger row's userId is authoritative (not the caller's session).
 */
export async function getAgentLoopById(
  loopId: string,
): Promise<AgentLoop | null> {
  const loop = await db.query.agentLoops.findFirst({
    where: eq(agentLoops.id, loopId),
  });
  return loop ?? null;
}

/**
 * Returns the id of the most-recently-created active run for the loop, or null
 * if no run is in queued, running, or paused status.
 *
 * Returning the run id (rather than a boolean) allows callers to record
 * skip events against the active run's id, satisfying the FK constraint on
 * agent_loop_events.loop_run_id → agent_loop_runs.id.
 * (Single-active-run rule enforcement in M1-07 dispatcher bridge.)
 */
export async function hasActiveRunForLoop(
  loopId: string,
): Promise<string | null> {
  const activeStatuses: AgentLoopRun["status"][] = [
    "queued",
    "running",
    "paused",
  ];
  const [row] = await db
    .select({ id: agentLoopRuns.id })
    .from(agentLoopRuns)
    .where(
      and(
        eq(agentLoopRuns.loopId, loopId),
        inArray(agentLoopRuns.status, activeStatuses),
      ),
    )
    .orderBy(desc(agentLoopRuns.createdAt))
    .limit(1);
  return row?.id ?? null;
}

// ── agentLoopRuns ─────────────────────────────────────────────────────────────

export type CreateAgentLoopRunResult = {
  run: AgentLoopRun;
  created: boolean;
};

/**
 * Creates a new agent loop run. Returns null when the loop does not exist or
 * is not owned by input.userId (cross-tenant protection). Returns
 * {run, created:false} when the idempotencyKey already exists (idempotent
 * retry — same shape as background-agents createRunForTrigger).
 */
export async function createAgentLoopRun(
  input: CreateAgentLoopRunInput,
): Promise<CreateAgentLoopRunResult | null> {
  // Verify loop ownership before inserting — prevents a caller from creating a
  // run against a loop owned by another user (independent FK would allow it).
  const ownedLoop = await getOwnedAgentLoop({
    userId: input.userId,
    loopId: input.loopId,
  });
  if (!ownedLoop) {
    return null;
  }

  const [inserted] = await db
    .insert(agentLoopRuns)
    .values({
      id: nanoid(),
      loopId: input.loopId,
      userId: input.userId,
      status: "queued",
      definitionSnapshot: input.definitionSnapshot,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      triggerId: input.triggerId ?? null,
      requestId: input.requestId ?? null,
    })
    .onConflictDoNothing({ target: agentLoopRuns.idempotencyKey })
    .returning();

  if (inserted) {
    return { run: inserted, created: true };
  }

  // Conflict suppressed — fetch the existing run.
  const existing = await db.query.agentLoopRuns.findFirst({
    where: eq(agentLoopRuns.idempotencyKey, input.idempotencyKey),
  });
  if (!existing) {
    throw new Error("Failed to create or load agent loop run");
  }

  return { run: existing, created: false };
}

export async function getAgentLoopRunWithLoop(
  runId: string,
): Promise<AgentLoopRunWithLoop | null> {
  const [row] = await db
    .select({ run: agentLoopRuns, loop: agentLoops })
    .from(agentLoopRuns)
    .leftJoin(agentLoops, eq(agentLoops.id, agentLoopRuns.loopId))
    .where(eq(agentLoopRuns.id, runId))
    .limit(1);

  if (!row?.loop) {
    return null;
  }

  return { run: row.run, loop: row.loop };
}

export async function listAgentLoopRuns(params: {
  loopId: string;
  userId: string;
  limit?: number;
}): Promise<AgentLoopRun[]> {
  return db.query.agentLoopRuns.findMany({
    where: and(
      eq(agentLoopRuns.loopId, params.loopId),
      eq(agentLoopRuns.userId, params.userId),
    ),
    orderBy: [desc(agentLoopRuns.createdAt)],
    limit: Math.min(Math.max(params.limit ?? 50, 1), 200),
  });
}

export async function updateAgentLoopRunStatus(params: {
  runId: string;
  status: AgentLoopRun["status"];
  currentNodeId?: string | null;
  currentStepRunId?: string | null;
  workflowRunId?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  iterationCount?: number;
  stepCount?: number;
  context?: Record<string, unknown>;
}): Promise<AgentLoopRun | null> {
  const terminalStatuses = new Set<AgentLoopRun["status"]>([
    "completed",
    "failed",
    "cancelled",
    "stalled",
  ]);
  const now = new Date();

  // Transitioning INTO running: only set startedAt when it is currently null
  // (prevents repeated "running" context-merge calls from resetting the timestamp
  // and corrupting duration accounting / the M1-06 wall-clock guardrail).
  // D1 fix: use NOW() SQL function, not a JS Date parameter — the postgres v3
  // driver's Bind() cannot serialize a Date instance (live-proof D1).
  const startedAtClause =
    params.status === "running"
      ? { startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, NOW())` }
      : {};

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: params.status,
      ...(params.currentNodeId !== undefined
        ? { currentNodeId: params.currentNodeId }
        : {}),
      ...(params.currentStepRunId !== undefined
        ? { currentStepRunId: params.currentStepRunId }
        : {}),
      ...(params.workflowRunId !== undefined
        ? { workflowRunId: params.workflowRunId }
        : {}),
      ...(params.errorKind !== undefined
        ? { errorKind: params.errorKind }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: params.errorMessage }
        : {}),
      ...(params.iterationCount !== undefined
        ? { iterationCount: params.iterationCount }
        : {}),
      ...(params.stepCount !== undefined
        ? { stepCount: params.stepCount }
        : {}),
      ...(params.context !== undefined ? { context: params.context } : {}),
      ...startedAtClause,
      ...(terminalStatuses.has(params.status) ? { finishedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(agentLoopRuns.id, params.runId))
    .returning();

  return run ?? null;
}

/**
 * Updates only the run context (and updatedAt).  Used by the step executor's
 * context-merge path after a successful github_check so that the run's
 * startedAt timestamp is never disturbed by a repeated "running" status write.
 */
export async function updateAgentLoopRunContext(params: {
  runId: string;
  context: Record<string, unknown>;
}): Promise<AgentLoopRun | null> {
  const now = new Date();

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      context: params.context,
      updatedAt: now,
    })
    .where(eq(agentLoopRuns.id, params.runId))
    .returning();

  return run ?? null;
}

/**
 * Sets the initial step pointer on a newly-created run row.
 *
 * Called by the dispatcher bridge immediately after creating the first (start-node)
 * step run and BEFORE dispatching the workflow.  Without this call,
 * currentNodeId and currentStepRunId stay NULL on the row, causing
 * advanceRunToNextStep's conditional WHERE (currentStepRunId = fromStepRunId)
 * to match 0 rows (NULL ≠ any value in SQL) — so the first advance always
 * returns false and the chain dies after the start node.
 *
 * This helper intentionally only updates currentNodeId, currentStepRunId, and
 * updatedAt.  It does NOT touch status or startedAt — those transitions are
 * owned by chain.ts (queued→running conditional update) and are deliberate
 * gate-checks that must not be bypassed here.
 */
export async function setInitialStepPointer(params: {
  runId: string;
  nodeId: string;
  stepRunId: string;
}): Promise<{ id: string } | null> {
  const now = new Date();

  const [row] = await db
    .update(agentLoopRuns)
    .set({
      currentNodeId: params.nodeId,
      currentStepRunId: params.stepRunId,
      updatedAt: now,
    })
    .where(eq(agentLoopRuns.id, params.runId))
    .returning({ id: agentLoopRuns.id });

  return row ?? null;
}

// ── agentLoopStepRuns ─────────────────────────────────────────────────────────

// ── agentLoopStepRuns — read ──────────────────────────────────────────────────

export type AgentLoopStepRunWithContext = {
  stepRun: AgentLoopStepRun;
  loopRun: AgentLoopRun;
  loop: AgentLoop;
};

/**
 * Loads a step run together with its parent loop run and the loop definition
 * row. Used by the step executor to obtain all data it needs in one round trip.
 * Returns null when the step run does not exist or the loop join fails.
 */
export async function getAgentLoopStepRunWithContext(
  stepRunId: string,
): Promise<AgentLoopStepRunWithContext | null> {
  const stepRun = await db.query.agentLoopStepRuns.findFirst({
    where: eq(agentLoopStepRuns.id, stepRunId),
  });
  if (!stepRun) {
    return null;
  }

  const row = await getAgentLoopRunWithLoop(stepRun.loopRunId);
  if (!row) {
    return null;
  }

  return { stepRun, loopRun: row.run, loop: row.loop };
}

export async function createAgentLoopStepRun(
  input: CreateAgentLoopStepRunInput,
): Promise<AgentLoopStepRun> {
  const [step] = await db
    .insert(agentLoopStepRuns)
    .values({
      id: nanoid(),
      loopRunId: input.loopRunId,
      nodeId: input.nodeId,
      nodeKind: input.nodeKind,
      attempt: input.attempt ?? 1,
      status: "queued",
      stepInput: input.stepInput ?? null,
    })
    .returning();

  if (!step) {
    throw new Error("Failed to create agent loop step run");
  }

  return step;
}

export async function updateAgentLoopStepRun(
  params: UpdateAgentLoopStepRunInput,
): Promise<AgentLoopStepRun | null> {
  const terminalStatuses = new Set<NonNullable<typeof params.status>>([
    "succeeded",
    "failed",
    "skipped",
  ]);
  const now = new Date();

  const [step] = await db
    .update(agentLoopStepRuns)
    .set({
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.stepOutput !== undefined
        ? { stepOutput: params.stepOutput }
        : {}),
      ...(params.sandboxName !== undefined
        ? { sandboxName: params.sandboxName }
        : {}),
      ...(params.workflowRunId !== undefined
        ? { workflowRunId: params.workflowRunId }
        : {}),
      ...(params.errorKind !== undefined
        ? { errorKind: params.errorKind }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: params.errorMessage }
        : {}),
      ...(params.durationMs !== undefined
        ? { durationMs: params.durationMs }
        : {}),
      ...(params.status === "running"
        ? { startedAt: params.startedAt ?? now }
        : {}),
      ...(params.status !== undefined && terminalStatuses.has(params.status)
        ? { finishedAt: params.finishedAt ?? now }
        : {}),
    })
    .where(eq(agentLoopStepRuns.id, params.stepRunId))
    .returning();

  return step ?? null;
}

// ── agentLoopEvents ───────────────────────────────────────────────────────────

export async function recordAgentLoopEvent(
  input: RecordAgentLoopEventInput,
): Promise<AgentLoopEvent> {
  const [event] = await db
    .insert(agentLoopEvents)
    .values({
      id: nanoid(),
      loopRunId: input.loopRunId,
      stepRunId: input.stepRunId ?? null,
      nodeId: input.nodeId ?? null,
      eventName: input.eventName,
      status: input.status,
      level: input.level ?? "info",
      summary: input.summary ?? null,
      // Reuse the background-agent redaction pipeline — same secrets taxonomy.
      payload: redactBackgroundAgentPayload(input.payload),
      redactionStatus: "passed",
      requestId: input.requestId ?? null,
      workflowRunId: input.workflowRunId ?? null,
    })
    .returning();

  if (!event) {
    throw new Error("Failed to record agent loop event");
  }

  return event;
}

export async function listAgentLoopEvents(
  loopRunId: string,
): Promise<AgentLoopEvent[]> {
  return db.query.agentLoopEvents.findMany({
    where: eq(agentLoopEvents.loopRunId, loopRunId),
    orderBy: [desc(agentLoopEvents.createdAt)],
    limit: 200,
  });
}

// ── Chain-level store functions (M1-06) ───────────────────────────────────────

/**
 * Atomically advances the run to the next step ONLY IF `currentStepRunId`
 * still equals `fromStepRunId` (anti-double-dispatch guard).
 *
 * Returns true if the update succeeded (1 row updated), false if it was a
 * no-op (0 rows — another invocation already advanced this step).
 *
 * This is the canonical conditional update that prevents two concurrent
 * chain invocations from both dispatching the next step.
 */
export async function advanceRunToNextStep(params: {
  runId: string;
  fromStepRunId: string;
  nextNodeId: string;
  nextStepRunId: string;
  stepCount: number;
  iterationCount: number;
  workflowRunId: string;
}): Promise<boolean> {
  const now = new Date();

  const result = await db
    .update(agentLoopRuns)
    .set({
      currentNodeId: params.nextNodeId,
      currentStepRunId: params.nextStepRunId,
      stepCount: params.stepCount,
      iterationCount: params.iterationCount,
      workflowRunId: params.workflowRunId,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentLoopRuns.id, params.runId),
        eq(agentLoopRuns.currentStepRunId, params.fromStepRunId),
      ),
    )
    .returning({ id: agentLoopRuns.id });

  return result.length > 0;
}

/**
 * Counts prior step runs for a (loopRunId, nodeId) pair.
 * Used to determine if visiting a node again constitutes a loop iteration
 * (priorVisits > 0 means a cycle is happening).
 */
export async function countStepRunsForNode(params: {
  loopRunId: string;
  nodeId: string;
}): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(agentLoopStepRuns)
    .where(
      and(
        eq(agentLoopStepRuns.loopRunId, params.loopRunId),
        eq(agentLoopStepRuns.nodeId, params.nodeId),
      ),
    );

  return row?.total ?? 0;
}

/**
 * Returns the maximum attempt number seen so far for a (loopRunId, nodeId)
 * pair. Used by advanceLoopRun to compute the next attempt as MAX+1.
 *
 * Using MAX instead of COUNT is sparse-safe: if attempts {1, 3} exist
 * (e.g. after a skip), COUNT would give 2 causing attempt 3 to collide,
 * while MAX gives 3 → next attempt 4 which is always safe.
 *
 * Returns 0 when no rows exist (first visit → attempt = 0+1 = 1).
 */
export async function getMaxAttemptForNode(params: {
  loopRunId: string;
  nodeId: string;
}): Promise<number> {
  const [row] = await db
    .select({ maxAttempt: sql<number>`MAX(${agentLoopStepRuns.attempt})` })
    .from(agentLoopStepRuns)
    .where(
      and(
        eq(agentLoopStepRuns.loopRunId, params.loopRunId),
        eq(agentLoopStepRuns.nodeId, params.nodeId),
      ),
    );

  return row?.maxAttempt ?? 0;
}

/**
 * Transitions a run from running/queued to paused.
 * Throws RunControlError if the conditional UPDATE matches zero rows.
 * Performs a re-check SELECT to distinguish:
 *   - not_found: run doesn't exist or is not owned by userId (no existence leak)
 *   - illegal_transition: run exists and is owned but not in a pausable status
 *
 * The WHERE clause includes userId so that a mismatched userId produces the
 * same "0 rows updated" outcome as a non-existent runId — no existence leak.
 */
export async function pauseLoopRun(
  runId: string,
  userId: string,
): Promise<AgentLoopRun> {
  const now = new Date();

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: "paused",
      updatedAt: now,
    })
    .where(
      and(
        eq(agentLoopRuns.id, runId),
        eq(agentLoopRuns.userId, userId),
        sql`${agentLoopRuns.status} IN ('running', 'queued')`,
      ),
    )
    .returning();

  if (!run) {
    // Re-check: determine if the run exists and is owned by userId.
    // A non-owned run must be indistinguishable from a missing run (not_found).
    const [existing] = await db
      .select({ id: agentLoopRuns.id })
      .from(agentLoopRuns)
      .where(and(eq(agentLoopRuns.id, runId), eq(agentLoopRuns.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }

    throw new RunControlError(
      "illegal_transition",
      `Cannot pause run ${runId}: not in a pausable status (running/queued)`,
    );
  }

  return run;
}

/**
 * Transitions a run from running/queued/paused to cancelled.
 * Throws RunControlError if the conditional UPDATE matches zero rows.
 * Performs a re-check SELECT to distinguish:
 *   - not_found: run doesn't exist or is not owned by userId (no existence leak)
 *   - illegal_transition: run exists and is owned but not in a cancellable status
 *
 * The WHERE clause includes userId so that a mismatched userId produces the
 * same "0 rows updated" outcome as a non-existent runId — no existence leak.
 */
export async function cancelLoopRun(
  runId: string,
  userId: string,
): Promise<AgentLoopRun> {
  const now = new Date();

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: "cancelled",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentLoopRuns.id, runId),
        eq(agentLoopRuns.userId, userId),
        sql`${agentLoopRuns.status} IN ('running', 'queued', 'paused')`,
      ),
    )
    .returning();

  if (!run) {
    // Re-check: determine if the run exists and is owned by userId.
    const [existing] = await db
      .select({ id: agentLoopRuns.id })
      .from(agentLoopRuns)
      .where(and(eq(agentLoopRuns.id, runId), eq(agentLoopRuns.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }

    throw new RunControlError(
      "illegal_transition",
      `Cannot cancel run ${runId}: not in a cancellable status (running/queued/paused)`,
    );
  }

  return run;
}

/**
 * Transitions a run from paused to running.
 * Throws RunControlError if the conditional UPDATE matches zero rows.
 * Performs a re-check SELECT to distinguish:
 *   - not_found: run doesn't exist or is not owned by userId (no existence leak)
 *   - illegal_transition: run exists and is owned but not in paused status
 *
 * The WHERE clause includes userId so that a mismatched userId produces the
 * same "0 rows updated" outcome as a non-existent runId — no existence leak.
 *
 * Resume now cleans up the "pause landed mid-execution" case: if a step
 * completed but the advance had not yet fired when pause landed, the run
 * may be in paused state with currentStepRunId pointing at a QUEUED next
 * step.  The caller (chain.resumeLoopRun) re-dispatches that queued step
 * immediately after this transition, so the chain resumes without needing
 * the stall sweep.
 */
export async function resumeLoopRun(
  runId: string,
  userId: string,
): Promise<AgentLoopRun> {
  const now = new Date();

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: "running",
      // COALESCE: preserve startedAt if already set.
      // D1 fix: use NOW() SQL function, not a JS Date parameter — the postgres v3
      // driver's Bind() cannot serialize a Date instance (live-proof D1).
      startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, NOW())`,
      updatedAt: now,
    })
    .where(
      and(
        eq(agentLoopRuns.id, runId),
        eq(agentLoopRuns.userId, userId),
        eq(agentLoopRuns.status, "paused"),
      ),
    )
    .returning();

  if (!run) {
    // Re-check: determine if the run exists and is owned by userId.
    const [existing] = await db
      .select({ id: agentLoopRuns.id })
      .from(agentLoopRuns)
      .where(and(eq(agentLoopRuns.id, runId), eq(agentLoopRuns.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new RunControlError("not_found", `Loop run not found: ${runId}`);
    }

    throw new RunControlError(
      "illegal_transition",
      `Cannot resume run ${runId}: not in paused status`,
    );
  }

  return run;
}

/**
 * Transitions a failed/stalled run to running and creates attempt n+1 of the
 * current step node. Returns the new step run so the caller can dispatch it.
 *
 * Throws if the run is not in a retryable status (failed/stalled), is not
 * owned by userId, or if currentNodeId/currentStepRunId are not set.
 *
 * Ownership is verified by loading the run with both runId AND userId in the
 * WHERE clause, so a mismatched userId is indistinguishable from a missing run
 * — no existence leak.
 */
export async function retryCurrentStep(params: {
  runId: string;
  userId: string;
}): Promise<AgentLoopStepRun> {
  // Load the run — ownership-scoped: userId must match to prevent cross-user retry
  const run = await db.query.agentLoopRuns.findFirst({
    where: and(
      eq(agentLoopRuns.id, params.runId),
      eq(agentLoopRuns.userId, params.userId),
    ),
  });

  if (!run) {
    throw new RunControlError(
      "not_found",
      `Loop run not found: ${params.runId}`,
    );
  }

  if (run.status !== "failed" && run.status !== "stalled") {
    throw new RunControlError(
      "illegal_transition",
      `Cannot retry run ${params.runId}: not in a retryable status (failed/stalled), got: ${run.status}`,
    );
  }

  if (!run.currentNodeId || !run.currentStepRunId) {
    throw new RunControlError(
      "illegal_transition",
      `Cannot retry run ${params.runId}: missing currentNodeId or currentStepRunId`,
    );
  }

  // Find the current (failed) step run to get nodeKind
  const failedStepRun = await db.query.agentLoopStepRuns.findFirst({
    where: eq(agentLoopStepRuns.id, run.currentStepRunId),
  });

  if (!failedStepRun) {
    throw new Error(`Cannot retry: step run ${run.currentStepRunId} not found`);
  }

  // Use MAX(attempt) to compute n+1 — sparse-safe: if attempts {1,3} exist,
  // MAX=3 → nextAttempt=4, whereas COUNT=2 → nextAttempt=3 would collide.
  const [attemptRow] = await db
    .select({ maxAttempt: sql<number>`MAX(${agentLoopStepRuns.attempt})` })
    .from(agentLoopStepRuns)
    .where(
      and(
        eq(agentLoopStepRuns.loopRunId, params.runId),
        eq(agentLoopStepRuns.nodeId, run.currentNodeId),
      ),
    );

  const nextAttempt = (attemptRow?.maxAttempt ?? 0) + 1;

  // Create the new step run
  const [newStepRun] = await db
    .insert(agentLoopStepRuns)
    .values({
      id: nanoid(),
      loopRunId: params.runId,
      nodeId: run.currentNodeId,
      nodeKind: failedStepRun.nodeKind,
      attempt: nextAttempt,
      status: "queued",
    })
    .returning();

  if (!newStepRun) {
    throw new Error("Failed to create retry step run");
  }

  // Transition the run to running and update currentStepRunId
  const now = new Date();
  await db
    .update(agentLoopRuns)
    .set({
      status: "running",
      currentStepRunId: newStepRun.id,
      // COALESCE: preserve startedAt if already set.
      // D1 fix: use NOW() SQL function, not a JS Date parameter — the postgres v3
      // driver's Bind() cannot serialize a Date instance (live-proof D1).
      startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, NOW())`,
      updatedAt: now,
    })
    .where(eq(agentLoopRuns.id, params.runId));

  return newStepRun;
}

/**
 * Conditionally transitions a run's status to a new value ONLY IF the run's
 * current DB status matches one of the allowed from-statuses.
 *
 * Returns the updated run when the transition succeeded (1 row), or null when
 * 0 rows were updated (status changed underneath — e.g. cancel raced with
 * the queued→running transition in chain.ts).
 *
 * Used by:
 *   - chain.ts queued→running transition (M1-10 race fix): fromStatuses=["queued"]
 *   - sweep stall transition: fromStatuses=["queued", "running"]
 */
export async function conditionallyTransitionRunStatus(params: {
  runId: string;
  toStatus: AgentLoopRun["status"];
  fromStatuses: AgentLoopRun["status"][];
  errorKind?: string | null;
  errorMessage?: string | null;
}): Promise<AgentLoopRun | null> {
  const now = new Date();

  const terminalStatuses = new Set<AgentLoopRun["status"]>([
    "completed",
    "failed",
    "cancelled",
    "stalled",
  ]);

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: params.toStatus,
      // D1 fix: use NOW() SQL function, not a JS Date parameter — the postgres v3
      // driver's Bind() cannot serialize a Date instance (live-proof D1).
      ...(params.toStatus === "running"
        ? { startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, NOW())` }
        : {}),
      ...(terminalStatuses.has(params.toStatus) ? { finishedAt: now } : {}),
      ...(params.errorKind !== undefined
        ? { errorKind: params.errorKind }
        : {}),
      ...(params.errorMessage !== undefined
        ? { errorMessage: params.errorMessage }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(agentLoopRuns.id, params.runId),
        inArray(agentLoopRuns.status, params.fromStatuses),
      ),
    )
    .returning();

  return run ?? null;
}

// ── Stall sweep ───────────────────────────────────────────────────────────────

export type StalledLoopRunCandidate = {
  id: string;
  status: "queued" | "running";
  lastEventName: string | null;
  lastEventAt: Date;
};

/**
 * Finds active (queued/running) loop runs whose latest event is older than
 * thresholdMinutes.  Paused and terminal runs are excluded.
 *
 * Uses a lateral-style subquery via Drizzle's max() aggregation: for each
 * qualifying run, we join to agent_loop_events and pick MAX(created_at).
 * Runs with no events at all are included (we use the run's own createdAt
 * as the reference age so brand-new runs without events don't stall
 * immediately — however runs that have never emitted an event after
 * thresholdMinutes are considered stalled).
 *
 * Returns an array of candidates the sweep should mark stalled.
 */
export async function findStalledLoopRunCandidates(params: {
  thresholdMinutes: number;
}): Promise<StalledLoopRunCandidate[]> {
  const cutoff = new Date(Date.now() - params.thresholdMinutes * 60 * 1000);

  // Subquery: for each run, the MAX(event.createdAt) and the corresponding
  // event name.  We use a raw SQL subquery via Drizzle's sql helper because
  // Drizzle ORM does not expose LATERAL joins.
  //
  // Equivalent SQL:
  //   SELECT r.id, r.status,
  //     (SELECT e.event_name FROM agent_loop_events e
  //       WHERE e.loop_run_id = r.id ORDER BY e.created_at DESC LIMIT 1) AS last_event_name,
  //     COALESCE(
  //       (SELECT MAX(e.created_at) FROM agent_loop_events e WHERE e.loop_run_id = r.id),
  //       r.created_at
  //     ) AS last_event_at
  //   FROM agent_loop_runs r
  //   WHERE r.status IN ('queued', 'running')
  //   HAVING last_event_at < $cutoff
  //
  // We implement this with Drizzle select + raw SQL expressions.

  const rows = await db
    .select({
      id: agentLoopRuns.id,
      status: agentLoopRuns.status,
      lastEventName: sql<string | null>`(
        SELECT ${agentLoopEvents.eventName}
        FROM ${agentLoopEvents}
        WHERE ${agentLoopEvents.loopRunId} = ${agentLoopRuns.id}
        ORDER BY ${agentLoopEvents.createdAt} DESC
        LIMIT 1
      )`,
      lastEventAt: sql<Date>`COALESCE(
        (SELECT MAX(${agentLoopEvents.createdAt})
         FROM ${agentLoopEvents}
         WHERE ${agentLoopEvents.loopRunId} = ${agentLoopRuns.id}),
        ${agentLoopRuns.createdAt}
      )`,
    })
    .from(agentLoopRuns)
    .where(
      and(
        inArray(agentLoopRuns.status, ["queued", "running"]),
        // Only include runs where the latest event (or createdAt) is before the cutoff.
        // We embed this filter in a HAVING-equivalent by using a subquery in WHERE.
        sql`COALESCE(
          (SELECT MAX(${agentLoopEvents.createdAt})
           FROM ${agentLoopEvents}
           WHERE ${agentLoopEvents.loopRunId} = ${agentLoopRuns.id}),
          ${agentLoopRuns.createdAt}
        ) < ${cutoff}`,
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    status: row.status as "queued" | "running",
    lastEventName: row.lastEventName,
    lastEventAt:
      row.lastEventAt instanceof Date
        ? row.lastEventAt
        : new Date(row.lastEventAt),
  }));
}
