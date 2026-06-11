import "server-only";

import { and, count, desc, eq, sql } from "drizzle-orm";
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

export async function listAgentLoops(userId: string): Promise<AgentLoop[]> {
  return db.query.agentLoops.findMany({
    where: eq(agentLoops.userId, userId),
    orderBy: [desc(agentLoops.updatedAt)],
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
  const startedAtClause =
    params.status === "running"
      ? { startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, ${now})` }
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
 * Used to determine if visiting a node again constitutes a loop iteration.
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
 * Transitions a run from running/queued to paused.
 * Throws if the run is not in a pausable status.
 */
export async function pauseLoopRun(
  runId: string,
  _userId: string,
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
        sql`${agentLoopRuns.status} IN ('running', 'queued')`,
      ),
    )
    .returning();

  if (!run) {
    throw new Error(
      `Cannot pause run ${runId}: not in a pausable status (running/queued)`,
    );
  }

  return run;
}

/**
 * Transitions a run from running/queued/paused to cancelled.
 * Throws if the run is not in a cancellable status.
 */
export async function cancelLoopRun(
  runId: string,
  _userId: string,
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
        sql`${agentLoopRuns.status} IN ('running', 'queued', 'paused')`,
      ),
    )
    .returning();

  if (!run) {
    throw new Error(
      `Cannot cancel run ${runId}: not in a cancellable status (running/queued/paused)`,
    );
  }

  return run;
}

/**
 * Transitions a run from paused to running.
 * Throws if the run is not paused.
 */
export async function resumeLoopRun(
  runId: string,
  _userId: string,
): Promise<AgentLoopRun> {
  const now = new Date();

  const [run] = await db
    .update(agentLoopRuns)
    .set({
      status: "running",
      // COALESCE: preserve startedAt if already set
      startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, ${now})`,
      updatedAt: now,
    })
    .where(and(eq(agentLoopRuns.id, runId), eq(agentLoopRuns.status, "paused")))
    .returning();

  if (!run) {
    throw new Error(`Cannot resume run ${runId}: not in paused status`);
  }

  return run;
}

/**
 * Transitions a failed/stalled run to running and creates attempt n+1 of the
 * current step node. Returns the new step run so the caller can dispatch it.
 *
 * Throws if the run is not in a retryable status (failed/stalled) or if
 * currentNodeId/currentStepRunId are not set.
 */
export async function retryCurrentStep(params: {
  runId: string;
  userId: string;
}): Promise<AgentLoopStepRun> {
  // Load the run
  const run = await db.query.agentLoopRuns.findFirst({
    where: eq(agentLoopRuns.id, params.runId),
  });

  if (!run) {
    throw new Error(`Run ${params.runId} not found`);
  }

  if (run.status !== "failed" && run.status !== "stalled") {
    throw new Error(
      `Cannot retry run ${params.runId}: not in a retryable status (failed/stalled), got: ${run.status}`,
    );
  }

  if (!run.currentNodeId || !run.currentStepRunId) {
    throw new Error(
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

  // Count attempts so far to compute n+1
  const [attemptRow] = await db
    .select({ maxAttempt: sql<number>`MAX(${agentLoopStepRuns.attempt})` })
    .from(agentLoopStepRuns)
    .where(
      and(
        eq(agentLoopStepRuns.loopRunId, params.runId),
        eq(agentLoopStepRuns.nodeId, run.currentNodeId),
      ),
    );

  const nextAttempt = (attemptRow?.maxAttempt ?? 1) + 1;

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
      // COALESCE: preserve startedAt if already set
      startedAt: sql`COALESCE(${agentLoopRuns.startedAt}, ${now})`,
      updatedAt: now,
    })
    .where(eq(agentLoopRuns.id, params.runId));

  return newStepRun;
}
