/**
 * Agent Loops — chain.ts (M1-06)
 *
 * runAgentLoopStep({ stepRunId, workflowRunId }):
 *   1. Cooperative pre-check — if paused/cancelled/completed/failed → skip (event).
 *   2. If queued → transition to running + emit run.started.
 *   3. Guardrail check BEFORE execution (resolveGuardrails, clamp to ceilings).
 *      — If tripped, current step run is marked "skipped" (finishedAt set) before
 *        failing the run so the timeline stays coherent.
 *   4. Execute step (executeAgentLoopStep).
 *   5. If end node (run is now completed by executor) → stop, no dispatch.
 *   6. Advance (evaluateEdges, iteration counting, atomic conditional update).
 *   7. Create next step run + dispatch via start().
 *
 * Attempt semantics:
 *   "attempt" = nth execution of (loopRunId, nodeId) within this run.
 *   - First visit to a node: attempt 1.
 *   - Cycle revisit: attempt = priorVisits + 1 (countStepRunsForNode counts
 *     EXISTING rows before the new one is inserted).
 *   - Retry via retryCurrentStep: MAX(existing attempts) + 1 — consistent with
 *     the same priorVisits + 1 semantics.
 *   This definition satisfies the UNIQUE index on (loopRunId, nodeId, attempt)
 *   both for cycles and for explicit retries.
 *
 * Unique-constraint duplicate-advance defence:
 *   createAgentLoopStepRun can throw a PG 23505 unique-violation if two
 *   concurrent invocations race to insert (same loopRunId, nodeId, attempt).
 *   When that happens the insert is treated as a duplicate-advance: a
 *   "agent-loop.chain.skipped" event is recorded with reason "duplicate_advance"
 *   and the function returns without dispatching.
 *
 * advanceLoopRun — exported for tests; handles post-execution routing.
 * resolveGuardrails — pure helper, testable independently.
 * pauseLoopRun / cancelLoopRun / resumeLoopRun / retryCurrentStep — control plane.
 */

import "server-only";

import { start } from "workflow/api";
import {
  GUARDRAIL_DEFAULTS,
  GUARDRAIL_CEILINGS,
  loopDefinitionSchema,
  type LoopGuardrails,
} from "./types";
import { evaluateEdges } from "./edge-evaluator";
import {
  getAgentLoopStepRunWithContext,
  getAgentLoopRunWithLoop,
  updateAgentLoopRunStatus,
  updateAgentLoopStepRun,
  recordAgentLoopEvent,
  createAgentLoopStepRun,
  advanceRunToNextStep,
  countStepRunsForNode,
  getMaxAttemptForNode,
  pauseLoopRun as storePauseLoopRun,
  cancelLoopRun as storeCancelLoopRun,
  resumeLoopRun as storeResumeLoopRun,
  retryCurrentStep as storeRetryCurrentStep,
} from "./store";
import { executeAgentLoopStep } from "./step-executor";

// ── Public types ───────────────────────────────────────────────────────────────

export type RunAgentLoopStepParams = {
  stepRunId: string;
  workflowRunId: string;
};

export type ResolvedGuardrails = {
  maxStepsPerRun: number;
  maxIterations: number;
  maxRunDurationMs: number;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves user-supplied guardrails by:
 * 1. Falling back to GUARDRAIL_DEFAULTS for any missing field.
 * 2. Clamping each field to GUARDRAIL_CEILINGS (server-enforced maximums).
 *
 * Pure function — no I/O, testable independently.
 */
export function resolveGuardrails(
  userGuardrails: Partial<LoopGuardrails> | null | undefined,
): ResolvedGuardrails {
  const steps =
    userGuardrails?.maxStepsPerRun ?? GUARDRAIL_DEFAULTS.maxStepsPerRun;
  const iters =
    userGuardrails?.maxIterations ?? GUARDRAIL_DEFAULTS.maxIterations;
  const duration =
    userGuardrails?.maxRunDurationMs ?? GUARDRAIL_DEFAULTS.maxRunDurationMs;

  return {
    maxStepsPerRun: Math.min(steps, GUARDRAIL_CEILINGS.maxStepsPerRun),
    maxIterations: Math.min(iters, GUARDRAIL_CEILINGS.maxIterations),
    // No server ceiling on maxRunDurationMs per spec — apply as-is
    maxRunDurationMs: duration,
  };
}

// ── Core chain entry point ────────────────────────────────────────────────────

/**
 * Runs one step of the loop chain:
 * cooperative pre-check → guardrails → execute → advance → dispatch next step.
 *
 * This function is called by runAgentLoopStepWorkflow (the durable workflow).
 */
export async function runAgentLoopStep(
  params: RunAgentLoopStepParams,
): Promise<void> {
  "use step";

  const { stepRunId, workflowRunId } = params;

  // ── 1. Load context ────────────────────────────────────────────────────────

  const ctx = await getAgentLoopStepRunWithContext(stepRunId);
  if (!ctx) {
    // Cannot do anything useful without the DB row — log and bail.
    console.error(`[agent-loop.chain] Step run not found: ${stepRunId}`);
    return;
  }

  const { loopRun, loop } = ctx;
  const loopRunId = loopRun.id;

  // ── 2. Cooperative pre-check ───────────────────────────────────────────────

  const nonRunningStatuses = new Set([
    "paused",
    "cancelled",
    "completed",
    "failed",
  ]);
  if (nonRunningStatuses.has(loopRun.status)) {
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: ctx.stepRun.nodeId,
      eventName: "agent-loop.chain.skipped",
      status: "info",
      level: "info",
      summary: `Chain skipped: run is ${loopRun.status}`,
      payload: { reason: loopRun.status, stepRunId },
      workflowRunId,
    });
    return;
  }

  // ── 3. Queued → running transition ────────────────────────────────────────

  if (loopRun.status === "queued") {
    await updateAgentLoopRunStatus({
      runId: loopRunId,
      status: "running",
    });

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: ctx.stepRun.nodeId,
      eventName: "agent-loop.run.started",
      status: "started",
      level: "info",
      summary: "Loop run started",
      payload: { loopRunId, workflowRunId },
      workflowRunId,
    });
  }

  // ── 4. Guardrail check (before executing) ─────────────────────────────────

  // Parse user guardrails from the loop config (JSONB, may be null)
  const rawGuardrails = loop.guardrails as Partial<LoopGuardrails> | null;
  const guardrails = resolveGuardrails(rawGuardrails);
  const nodeId = ctx.stepRun.nodeId;

  // Wall-clock check (only if startedAt is set)
  const now = Date.now();
  const walledOut =
    loopRun.startedAt != null &&
    now - loopRun.startedAt.getTime() >= guardrails.maxRunDurationMs;

  const stepCountTripped = loopRun.stepCount >= guardrails.maxStepsPerRun;
  const iterCountTripped = loopRun.iterationCount >= guardrails.maxIterations;

  if (stepCountTripped || iterCountTripped || walledOut) {
    const whichGuardrail = stepCountTripped
      ? "maxStepsPerRun"
      : iterCountTripped
        ? "maxIterations"
        : "maxRunDurationMs";

    const payload: Record<string, unknown> = {
      whichGuardrail,
      stepCount: loopRun.stepCount,
      iterationCount: loopRun.iterationCount,
      maxStepsPerRun: guardrails.maxStepsPerRun,
      maxIterations: guardrails.maxIterations,
      maxRunDurationMs: guardrails.maxRunDurationMs,
    };
    if (loopRun.startedAt != null) {
      payload["elapsedMs"] = now - loopRun.startedAt.getTime();
    }

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.guardrail.tripped",
      status: "failed",
      level: "error",
      summary: `Guardrail tripped: ${whichGuardrail}`,
      payload,
      workflowRunId,
    });

    // Nit 2: Mark the current step run "skipped" so the timeline is coherent.
    // Without this the step run stays "queued" forever — no finishedAt, no
    // terminal status — making run timeline queries misleading.
    const guardrailNow = new Date();
    await updateAgentLoopStepRun({
      stepRunId,
      status: "skipped",
      finishedAt: guardrailNow,
    });

    await updateAgentLoopRunStatus({
      runId: loopRunId,
      status: "failed",
      errorKind: "guardrail_exceeded",
      errorMessage: `Guardrail exceeded: ${whichGuardrail}`,
    });

    return;
  }

  // ── 5. Execute the step ────────────────────────────────────────────────────

  const result = await executeAgentLoopStep({ stepRunId, workflowRunId });

  // ── 5b. Re-check run status after execution ────────────────────────────────
  //
  // A pause or cancel may have landed DURING the (potentially long) step
  // execution.  The status we loaded in step 1 is now stale.  Re-load the
  // run so we use the current status for the advance decision below.
  //
  // Why reload here and not earlier?  Earlier re-loads would require an extra
  // round-trip before every execution.  The cooperative pre-check in step 2
  // handles the common "already paused before dispatch" case; this re-check
  // covers the narrower "pause landed mid-execution" window.
  const reloadedCtx = await getAgentLoopRunWithLoop(loopRunId);
  const postExecStatus = reloadedCtx?.run.status ?? loopRun.status;

  // Cancelled / completed / failed during execution: no advance, no dispatch.
  // Record a skipped event with the new status for observability.
  const nonAdvanceStatuses = new Set(["cancelled", "completed", "failed"]);
  if (nonAdvanceStatuses.has(postExecStatus)) {
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.skipped",
      status: "info",
      level: "info",
      summary: `Chain skipped: run status changed to ${postExecStatus} during step execution`,
      payload: {
        reason: "status_changed_during_step",
        status: postExecStatus,
        stepRunId,
      },
      workflowRunId,
    });
    return;
  }

  // ── 6. Check if executor already finalized the run (end node) ─────────────

  // Re-load loopRun to see if status changed (end node sets it to completed)
  // We detect this by checking if the run's status is now completed/failed
  // The executor's end-node path calls updateAgentLoopRunStatus(completed).
  // We check by looking at the result: if the node was "end", there's no
  // outgoing edge — we check the outcome + whether run is now completed.
  // Actually, we check via the definition snapshot to avoid re-loading.
  const snapshotParse = loopDefinitionSchema.safeParse(
    loopRun.definitionSnapshot,
  );
  if (!snapshotParse.success) {
    // Nit 1: Do not silently return — record an observable event so this
    // failure shows up in the run timeline and can be detected by the stall
    // sweep. The run is left in its current status (running) so it can be
    // recovered via pause→resume.
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.skipped",
      status: "info",
      level: "warn",
      summary:
        "Chain skipped: definition snapshot could not be re-parsed after execution",
      payload: { reason: "snapshot_invalid", stepRunId },
      workflowRunId,
    });
    return;
  }

  const definition = snapshotParse.data;
  const node = definition.nodes.find((n) => n.id === nodeId);

  // End node: executor already finalized the run — no edge evaluation, no dispatch
  if (node?.kind === "end") {
    return;
  }

  // ── 7. Advance: evaluate edges + dispatch ─────────────────────────────────
  //
  // If run was paused DURING execution, we still perform the advance bookkeeping
  // (edge evaluation, step run creation, advanceRunToNextStep) so that
  // currentStepRunId points at the QUEUED next step.  resumeLoopRun then
  // re-dispatches that queued step and the chain resumes cleanly.
  // We pass pausedMidExecution=true to skip the start() call and instead
  // record a paused_before_dispatch event.

  const pausedMidExecution = postExecStatus === "paused";

  await advanceLoopRun({
    stepRunId,
    workflowRunId,
    loopRunId,
    nodeId,
    definition,
    outcome: result.outcome,
    errorKind: result.errorKind,
    currentStepCount: loopRun.stepCount,
    currentIterationCount: loopRun.iterationCount,
    nodeKind: node?.kind ?? "unknown",
    pausedMidExecution,
  });
}

// ── advanceLoopRun — exported for tests ──────────────────────────────────────

type AdvanceParams = {
  stepRunId: string;
  workflowRunId: string;
  loopRunId: string;
  nodeId: string;
  definition: ReturnType<typeof loopDefinitionSchema.parse>;
  outcome: "success" | "failure" | "true" | "false";
  errorKind?: string;
  currentStepCount: number;
  currentIterationCount: number;
  nodeKind: string;
  /**
   * True when the run was paused DURING step execution (i.e. the pause landed
   * between executeAgentLoopStep starting and returning).  Advance bookkeeping
   * is still performed so that currentStepRunId points at the queued next step,
   * but the workflow dispatch is suppressed — resumeLoopRun re-dispatches it.
   */
  pausedMidExecution?: boolean;
};

/**
 * Post-execution routing:
 * 1. evaluateEdges → nextNodeId
 * 2. If nextNodeId null → fail run (route missing / step's errorKind)
 * 3. Count prior visits to nextNodeId for iteration counting (countStepRunsForNode)
 * 4. Compute next attempt via MAX(attempt)+1 (getMaxAttemptForNode — sparse-safe)
 * 5. Atomic advance (conditional WHERE currentStepRunId = stepRunId)
 * 6. If 0 rows updated → duplicate advance — skip dispatch
 * 7. If pausedMidExecution → record paused_before_dispatch, no start() call
 * 8. Create next step run + dispatch workflow
 */
async function advanceLoopRun(params: AdvanceParams): Promise<void> {
  const {
    stepRunId,
    workflowRunId,
    loopRunId,
    nodeId,
    definition,
    outcome,
    errorKind,
    currentStepCount,
    currentIterationCount,
    nodeKind,
    pausedMidExecution = false,
  } = params;

  // ── 7a. Evaluate edges ────────────────────────────────────────────────────

  const { nextNodeId, edgeId } = evaluateEdges(definition, nodeId, outcome);

  await recordAgentLoopEvent({
    loopRunId,
    stepRunId,
    nodeId,
    eventName: "agent-loop.edge.evaluated",
    status: "info",
    level: "info",
    summary: `Edge evaluated: ${nodeId} → ${nextNodeId ?? "null"} (${outcome})`,
    payload: {
      nodeId,
      edgeId,
      outcome,
      nextNodeId,
      iterationCount: currentIterationCount,
      nodeKind,
    },
    workflowRunId,
  });

  // ── 7b. Handle null nextNodeId ────────────────────────────────────────────

  if (nextNodeId === null) {
    if (outcome === "failure") {
      // Failed step with no failure edge → run failed with step's errorKind
      await updateAgentLoopRunStatus({
        runId: loopRunId,
        status: "failed",
        errorKind: errorKind ?? "step_failed",
        errorMessage: `Step failed with no failure edge: ${nodeId}`,
      });
    } else {
      // Successful/true/false outcome with no matching edge (dangling or graph gap)
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.chain.route_missing",
        status: "failed",
        level: "error",
        summary: `No route from ${nodeId} for outcome: ${outcome}`,
        payload: { nodeId, outcome, edgeId },
        workflowRunId,
      });

      await updateAgentLoopRunStatus({
        runId: loopRunId,
        status: "failed",
        errorKind: "chain_route_missing",
        errorMessage: `No outgoing edge from '${nodeId}' for outcome '${outcome}' (dangling or missing edge)`,
      });
    }
    return;
  }

  // ── 7c. Iteration counting + attempt computation ──────────────────────────

  // countStepRunsForNode → used ONLY for iteration detection.
  // If ANY prior step run exists for (loopRunId, nextNodeId), it's a loop.
  const priorVisits = await countStepRunsForNode({
    loopRunId,
    nodeId: nextNodeId,
  });

  const newIterationCount =
    priorVisits > 0 ? currentIterationCount + 1 : currentIterationCount;
  const newStepCount = currentStepCount + 1;

  // ── 7d. Find the next node's kind for step run creation ──────────────────

  const nextNode = definition.nodes.find((n) => n.id === nextNodeId);
  const nextNodeKind = nextNode?.kind ?? "unknown";

  // ── 7e. Create the next step run ─────────────────────────────────────────
  //
  // attempt = MAX(existing attempts) + 1:
  //   - First visit to this node:  MAX = 0 (no rows) → attempt 1
  //   - Cycle revisit (loop-back): MAX = N → attempt N+1
  //
  // MAX-based computation is sparse-safe: if attempts {1,3} exist (e.g.
  // a prior skip left a gap), COUNT would give 2 → attempt 3 → collision
  // with the existing row.  MAX gives 3 → attempt 4, always safe.
  //
  // This guarantees the UNIQUE index on (loopRunId, nodeId, attempt) is
  // never violated by normal cycle traversal.
  //
  // Race defence: if two concurrent invocations both computed the same MAX
  // before either inserted, their inserts would have the same
  // (loopRunId, nodeId, attempt) and the DB would throw a unique-constraint
  // error (PG code 23505).  We catch that here and treat it identically to
  // advanceRunToNextStep returning false — one winner, one graceful skip.
  const maxAttemptSoFar = await getMaxAttemptForNode({
    loopRunId,
    nodeId: nextNodeId,
  });
  const nextAttempt = maxAttemptSoFar + 1;

  let nextStepRun: Awaited<ReturnType<typeof createAgentLoopStepRun>>;
  try {
    nextStepRun = await createAgentLoopStepRun({
      loopRunId,
      nodeId: nextNodeId,
      nodeKind: nextNodeKind,
      attempt: nextAttempt,
    });
  } catch (insertErr) {
    // Unique-constraint violation on (loopRunId, nodeId, attempt):
    // another racing invocation already inserted this step run.
    // Treat as a graceful duplicate-advance — emit event and stop.
    const isUniqueViolation =
      insertErr instanceof Error &&
      ((insertErr as unknown as Record<string, unknown>)["code"] === "23505" ||
        insertErr.message.includes("unique constraint") ||
        insertErr.message.includes("duplicate key"));

    if (isUniqueViolation) {
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.chain.skipped",
        status: "info",
        level: "info",
        summary:
          "Advance skipped: concurrent invocation already inserted this step run (unique-constraint)",
        payload: { reason: "duplicate_advance", stepRunId, nextNodeId },
        workflowRunId,
      });
      return;
    }
    // Not a uniqueness error — re-throw so we don't silently swallow
    // unexpected DB errors.
    throw insertErr;
  }

  // ── 7f. Atomic advance (anti-double-dispatch) ─────────────────────────────

  const advanced = await advanceRunToNextStep({
    runId: loopRunId,
    fromStepRunId: stepRunId,
    nextNodeId,
    nextStepRunId: nextStepRun.id,
    stepCount: newStepCount,
    iterationCount: newIterationCount,
    workflowRunId,
  });

  if (!advanced) {
    // Another invocation already advanced from this step — do not dispatch
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.skipped",
      status: "info",
      level: "info",
      summary: "Advance skipped: another invocation already advanced this step",
      payload: { reason: "duplicate_advance", stepRunId, nextNodeId },
      workflowRunId,
    });
    return;
  }

  // ── 7g. Pause mid-execution: bookkeeping done, skip dispatch ─────────────
  //
  // If the run was paused DURING step execution, advance bookkeeping has now
  // completed (edge evaluated, step run created, advanceRunToNextStep updated
  // currentStepRunId to the queued next step).  We must NOT dispatch the
  // workflow — the run is paused and resumeLoopRun will re-dispatch the queued
  // step when the operator resumes.  This leaves the chain in a clean state
  // with no stall and no extra dispatch.
  if (pausedMidExecution) {
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.paused_before_dispatch",
      status: "info",
      level: "info",
      summary: `Chain paused before dispatch of next step ${nextNodeId}; resume will re-dispatch`,
      payload: {
        nextNodeId,
        nextStepRunId: nextStepRun.id,
        nodeKind: nextNodeKind,
      },
      workflowRunId,
    });
    return;
  }

  // ── 7h. Dispatch next step workflow ────────────────────────────────────────

  try {
    // Dynamic import breaks the cycle: chain.ts ← agent-loop-step.ts ← chain.ts.
    // The workflow file imports runAgentLoopStep from this module, so we cannot
    // statically import the workflow file here without creating a circular dep.
    const { runAgentLoopStepWorkflow } =
      await import("@/app/workflows/agent-loop-step");
    await start(runAgentLoopStepWorkflow, [{ stepRunId: nextStepRun.id }]);

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.dispatched",
      status: "info",
      level: "info",
      summary: `Dispatched next step: ${nextNodeId}`,
      payload: {
        nextNodeId,
        nextStepRunId: nextStepRun.id,
        nodeKind: nextNodeKind,
      },
      workflowRunId,
    });
  } catch (err) {
    // Nit 3 — dispatch failure recovery gap:
    //
    // After chain.dispatch_failed the run stays in "running" status with
    // currentStepRunId pointing at the QUEUED next step run.
    //
    // Recovery options:
    //   1. Stall sweep (M1-10, not yet implemented): detects runs with no event
    //      for N minutes → marks stalled → operator can retry.
    //   2. Manual interim recovery: call pauseLoopRun → resumeLoopRun.
    //      resumeLoopRun re-dispatches the queued currentStepRunId.
    //      retryCurrentStep does NOT apply here because the run is still
    //      "running" (not failed/stalled), so it would throw.
    //
    // Until M1-10 is in place, pause→resume is the only self-service recovery.
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.dispatch_failed",
      status: "failed",
      level: "error",
      summary: `Failed to dispatch next step workflow for ${nextNodeId}`,
      payload: {
        nextNodeId,
        nextStepRunId: nextStepRun.id,
        error: err instanceof Error ? err.message : String(err),
      },
      workflowRunId,
    });
    // Do NOT fail the run — leave it in running state with currentStepRunId
    // pointing at the queued next step. The stall sweep (M1-10) or a manual
    // pause→resume will pick it up.
  }
}

// ── Control plane — pause/cancel/resume/retry ─────────────────────────────────

/**
 * Pauses a running or queued loop run. Cooperative — takes effect at the next
 * step boundary (does not interrupt in-progress step execution).
 */
export async function pauseLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  "use step";

  await storePauseLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.paused",
    status: "info",
    level: "info",
    summary: "Loop run paused",
    payload: { runId, userId },
  });
}

/**
 * Cancels a running, queued, or paused loop run.
 */
export async function cancelLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  "use step";

  await storeCancelLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.cancelled",
    status: "info",
    level: "info",
    summary: "Loop run cancelled",
    payload: { runId, userId },
  });
}

/**
 * Resumes a paused loop run. If currentStepRunId is queued, re-dispatches it.
 *
 * Pause-mid-execution clean resume:
 * When runAgentLoopStep detects a pause mid-execution, it still performs all
 * advance bookkeeping (edge evaluation, step run creation, advanceRunToNextStep)
 * so that currentStepRunId points at the QUEUED next step.  This means
 * resumeLoopRun re-dispatches the queued step immediately on resume and the
 * chain continues without any stall-sweep involvement.
 *
 * Stall edge case (pre-Finding-1 behaviour, now avoided for mid-execution pauses):
 * If a step had completed but advance had not yet fired when pause landed,
 * the run was left in running state with no pending dispatch. The stall sweep
 * (M1-10) handles this residual case. After Finding 1, this window is narrowed:
 * mid-execution pauses produce a queued next step that resume can pick up.
 *
 * Interim dispatch-failure recovery (Nit 3):
 * After a chain.dispatch_failed event the run stays "running" with a queued
 * currentStepRunId.  retryCurrentStep requires "failed" or "stalled" and will
 * throw if called while the run is still "running".  Until the M1-10 stall
 * sweep is implemented, the only self-service recovery path is:
 *   1. pauseLoopRun  — transitions to "paused"
 *   2. resumeLoopRun — transitions to "running" AND re-dispatches the queued step
 */
export async function resumeLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  "use step";

  // Transition → running (throws if not paused)
  const run = await storeResumeLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.resumed",
    status: "info",
    level: "info",
    summary: "Loop run resumed",
    payload: { runId, userId },
  });

  // Re-dispatch current step if it is still queued
  if (run.currentStepRunId) {
    try {
      const { runAgentLoopStepWorkflow } =
        await import("@/app/workflows/agent-loop-step");
      await start(runAgentLoopStepWorkflow, [
        { stepRunId: run.currentStepRunId },
      ]);

      await recordAgentLoopEvent({
        loopRunId: runId,
        eventName: "agent-loop.chain.dispatched",
        status: "info",
        level: "info",
        summary: `Re-dispatched step on resume: ${run.currentNodeId}`,
        payload: { stepRunId: run.currentStepRunId, resumed: true },
      });
    } catch (err) {
      await recordAgentLoopEvent({
        loopRunId: runId,
        eventName: "agent-loop.chain.dispatch_failed",
        status: "failed",
        level: "error",
        summary: "Failed to re-dispatch step on resume",
        payload: {
          stepRunId: run.currentStepRunId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Retries the current (failed or stalled) step of a loop run.
 * Creates attempt n+1 of the current node and dispatches its workflow.
 */
export async function retryCurrentStep(
  runId: string,
  userId: string,
): Promise<void> {
  "use step";

  // Creates a new step run (attempt n+1) and transitions run to running.
  // Throws if the run is not in a retryable status (failed/stalled).
  const newStepRun = await storeRetryCurrentStep({ runId, userId });

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.retry",
    status: "info",
    level: "info",
    summary: `Retrying step: attempt ${newStepRun.attempt}`,
    payload: {
      runId,
      userId,
      newStepRunId: newStepRun.id,
      attempt: newStepRun.attempt,
    },
  });

  try {
    const { runAgentLoopStepWorkflow } =
      await import("@/app/workflows/agent-loop-step");
    await start(runAgentLoopStepWorkflow, [{ stepRunId: newStepRun.id }]);

    await recordAgentLoopEvent({
      loopRunId: runId,
      eventName: "agent-loop.chain.dispatched",
      status: "info",
      level: "info",
      summary: `Dispatched retry step: ${newStepRun.nodeId} attempt ${newStepRun.attempt}`,
      payload: { stepRunId: newStepRun.id, attempt: newStepRun.attempt },
    });
  } catch (err) {
    await recordAgentLoopEvent({
      loopRunId: runId,
      eventName: "agent-loop.chain.dispatch_failed",
      status: "failed",
      level: "error",
      summary: "Failed to dispatch retry step",
      payload: {
        stepRunId: newStepRun.id,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
