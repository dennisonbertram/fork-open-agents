/**
 * Agent Loops — chain.ts (M1-06)
 *
 * runAgentLoopStep({ stepRunId, workflowRunId }):
 *   1. Cooperative pre-check — if paused/cancelled/completed/failed → skip (event).
 *   2. If queued → transition to running + emit run.started.
 *   3. Guardrail check BEFORE execution (resolveGuardrails, clamp to ceilings).
 *   4. Execute step (executeAgentLoopStep).
 *   5. If end node (run is now completed by executor) → stop, no dispatch.
 *   6. Advance (evaluateEdges, iteration counting, atomic conditional update).
 *   7. Create next step run + dispatch via start().
 *
 * advanceLoopRun — exported for tests; handles post-execution routing.
 * resolveGuardrails — pure helper, testable independently.
 * pauseLoopRun / cancelLoopRun / resumeLoopRun / retryCurrentStep — control plane.
 */

import "server-only";

import { start } from "workflow/api";
import { runAgentLoopStepWorkflow } from "@/app/workflows/agent-loop-step";
import { GUARDRAIL_DEFAULTS, GUARDRAIL_CEILINGS } from "./types";
import type { LoopGuardrails } from "./types";
import { evaluateEdges } from "./edge-evaluator";
import { loopDefinitionSchema } from "./types";
import {
  getAgentLoopStepRunWithContext,
  updateAgentLoopRunStatus,
  recordAgentLoopEvent,
  createAgentLoopStepRun,
  advanceRunToNextStep,
  countStepRunsForNode,
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
  const steps = userGuardrails?.maxStepsPerRun ?? GUARDRAIL_DEFAULTS.maxStepsPerRun;
  const iters = userGuardrails?.maxIterations ?? GUARDRAIL_DEFAULTS.maxIterations;
  const duration = userGuardrails?.maxRunDurationMs ?? GUARDRAIL_DEFAULTS.maxRunDurationMs;

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

  const nonRunningStatuses = new Set(["paused", "cancelled", "completed", "failed"]);
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

  // ── 6. Check if executor already finalized the run (end node) ─────────────

  // Re-load loopRun to see if status changed (end node sets it to completed)
  // We detect this by checking if the run's status is now completed/failed
  // The executor's end-node path calls updateAgentLoopRunStatus(completed).
  // We check by looking at the result: if the node was "end", there's no
  // outgoing edge — we check the outcome + whether run is now completed.
  // Actually, we check via the definition snapshot to avoid re-loading.
  const snapshotParse = loopDefinitionSchema.safeParse(loopRun.definitionSnapshot);
  if (!snapshotParse.success) {
    // Should not happen (step-executor handles this) but be defensive
    return;
  }

  const definition = snapshotParse.data;
  const node = definition.nodes.find((n) => n.id === nodeId);

  // End node: executor already finalized the run — no edge evaluation, no dispatch
  if (node?.kind === "end") {
    return;
  }

  // ── 7. Advance: evaluate edges + dispatch ─────────────────────────────────

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
};

/**
 * Post-execution routing:
 * 1. evaluateEdges → nextNodeId
 * 2. If nextNodeId null → fail run (route missing / step's errorKind)
 * 3. Count prior visits to nextNodeId for iteration counting
 * 4. Atomic advance (conditional WHERE currentStepRunId = stepRunId)
 * 5. If 0 rows updated → duplicate advance — skip dispatch
 * 6. Create next step run + dispatch workflow
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

  // ── 7c. Iteration counting ─────────────────────────────────────────────────

  // If ANY prior step run exists for (loopRunId, nextNodeId), it's a loop
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

  const nextStepRun = await createAgentLoopStepRun({
    loopRunId,
    nodeId: nextNodeId,
    nodeKind: nextNodeKind,
    attempt: 1,
  });

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

  // ── 7g. Dispatch next step workflow ────────────────────────────────────────

  try {
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
    // Dispatch failed: record event but leave run in running state.
    // The run's currentStepRunId now points at the QUEUED next step run.
    // This is recoverable by:
    //   - The stall sweep (M1-10): finds runs with no event for N minutes → marks stalled
    //   - Manual retry via retryCurrentStep (which re-dispatches the queued step)
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
    // pointing at the queued next step. The stall sweep will pick it up.
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
  const run = await storePauseLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.paused",
    status: "info",
    level: "info",
    summary: "Loop run paused",
    payload: { runId, userId },
  });

  void run; // used for type narrowing only; actual state is in DB
}

/**
 * Cancels a running, queued, or paused loop run.
 */
export async function cancelLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  const run = await storeCancelLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.cancelled",
    status: "info",
    level: "info",
    summary: "Loop run cancelled",
    payload: { runId, userId },
  });

  void run;
}

/**
 * Resumes a paused loop run. If currentStepRunId is queued, re-dispatches it.
 * If it has already succeeded (pause landed after execution, before advance),
 * the run will be picked up by the stall sweep — document this edge case.
 *
 * Note: if a step completed but advance had not yet fired when pause landed,
 * the run will be left in running state with no pending dispatch. The stall
 * sweep (M1-10) will detect the stall and route it for recovery.
 */
export async function resumeLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
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
  // Creates a new step run (attempt n+1) and transitions run to running.
  // Throws if the run is not in a retryable status (failed/stalled).
  const newStepRun = await storeRetryCurrentStep({ runId, userId });

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.retry",
    status: "info",
    level: "info",
    summary: `Retrying step: attempt ${newStepRun.attempt}`,
    payload: { runId, userId, newStepRunId: newStepRun.id, attempt: newStepRun.attempt },
  });

  try {
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
