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
 *
 * Control-plane (pause/cancel/resume/retry) lives in run-controls.ts.
 * That module is the canonical implementation; chain.ts does not re-export it.
 */

import "server-only";

import { start } from "workflow/api";
import {
  GUARDRAIL_DEFAULTS,
  GUARDRAIL_CEILINGS,
  loopDefinitionSchema,
  type LoopGuardrails,
  type ResolvedGuardrails,
} from "./types";
import { evaluateEdges } from "./edge-evaluator";
import { extractDefinitionGuardrails } from "./definition-guardrails";
import {
  getAgentLoopStepRunWithContext,
  getAgentLoopRunWithLoop,
  conditionallyTransitionRunStatus,
  updateAgentLoopStepRun,
  recordAgentLoopEvent,
  createAndAdvanceAgentLoopStep,
  countStepRunsForNode,
  getMaxAttemptForNode,
  isAgentLoopRunSourceLive,
} from "./store";
import { executeAgentLoopStep } from "./step-executor";
import { invokeWatchdog } from "./watchdog";
import { AgentLoopSourceDeletedError } from "./source-deleted-error";
import { AgentLoopSnapshotError } from "./execution-snapshot";

// ── Public types ───────────────────────────────────────────────────────────────

export type RunAgentLoopStepParams = {
  stepRunId: string;
  workflowRunId: string;
};

export type { ResolvedGuardrails };

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
  const stepTimeout =
    userGuardrails?.stepTimeoutMs ?? GUARDRAIL_DEFAULTS.stepTimeoutMs;
  const agentTurns =
    userGuardrails?.maxAgentTurnsPerStep ??
    GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep;

  return {
    maxStepsPerRun: Math.min(steps, GUARDRAIL_CEILINGS.maxStepsPerRun),
    maxIterations: Math.min(iters, GUARDRAIL_CEILINGS.maxIterations),
    // No server ceiling on maxRunDurationMs per spec — apply as-is
    maxRunDurationMs: duration,
    stepTimeoutMs: Math.min(stepTimeout, GUARDRAIL_CEILINGS.stepTimeoutMs),
    maxAgentTurnsPerStep: Math.min(
      agentTurns,
      GUARDRAIL_CEILINGS.maxAgentTurnsPerStep,
    ),
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

  let ctx: Awaited<ReturnType<typeof getAgentLoopStepRunWithContext>>;
  try {
    ctx = await getAgentLoopStepRunWithContext(stepRunId);
  } catch (error) {
    if (error instanceof AgentLoopSourceDeletedError) return;
    if (error instanceof AgentLoopSnapshotError && error.runId) {
      const transitioned = await conditionallyTransitionRunStatus({
        runId: error.runId,
        toStatus: "failed",
        fromStatuses: ["queued", "running", "stalled"],
        errorKind: error.errorKind,
        errorMessage: error.message,
      });
      if (transitioned) {
        const invalidSnapshotKinds = new Set([
          "snapshot_missing",
          "snapshot_invalid",
          "snapshot_version_unsupported",
          "snapshot_hash_mismatch",
        ]);
        const snapshotInvalid = invalidSnapshotKinds.has(error.errorKind);
        await updateAgentLoopStepRun({
          stepRunId,
          status: "skipped",
          errorKind: error.errorKind,
          errorMessage: error.message,
        });
        await recordAgentLoopEvent({
          loopRunId: error.runId,
          stepRunId,
          eventName: snapshotInvalid
            ? "agent-loop.snapshot.invalid"
            : "agent-loop.execution.revoked",
          status: "failed",
          level: "error",
          summary: snapshotInvalid
            ? "Loop execution definition could not be used."
            : "Loop execution authorization was revoked.",
          payload: { errorKind: error.errorKind },
          workflowRunId,
        });
      }
      return;
    }
    throw error;
  }
  if (!ctx) {
    // Cannot do anything useful without the DB row — log and bail.
    console.error(`[agent-loop.chain] Step run not found: ${stepRunId}`);
    return;
  }

  const { loopRun, loop } = ctx;
  const loopRunId = loopRun.id;

  // A delayed delivery for an older attempt must never route, retry, or invoke
  // the watchdog after the Run pointer has advanced to a newer step.
  if (
    loopRun.currentStepRunId !== null &&
    loopRun.currentStepRunId !== stepRunId
  ) {
    return;
  }

  if (ctx.snapshotSource) {
    const legacy = ctx.snapshotSource === "legacy_live_fallback";
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: ctx.stepRun.nodeId,
      eventName: legacy
        ? "agent-loop.snapshot.legacy_fallback"
        : "agent-loop.snapshot.validated",
      status: "succeeded",
      level: legacy ? "warn" : "info",
      summary: legacy
        ? "Using legacy live loop policy fallback."
        : "Validated frozen loop execution definition.",
      payload: {
        snapshotSource: ctx.snapshotSource,
        definitionVersion: ctx.definitionVersion,
        definitionHash: ctx.definitionHash,
      },
      workflowRunId,
    });
  }

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

  // ── 3. Queued → running transition (CONDITIONAL) ─────────────────────────
  //
  // Race fix (M1-10): the run may have been cancelled or stalled between the
  // load in step 1 and this transition.  We use a conditional UPDATE that
  // only fires when the current DB status is still "queued".  If 0 rows are
  // updated (status changed underneath), we treat this as the cooperative-skip
  // path — the cancel/stall is the source of truth and the chain should not
  // proceed.
  //
  // Without this guard (the pre-M1-10 behaviour), the unconditional UPDATE
  // would overwrite a cancelled status back to "running", causing noisy DB
  // constraint errors and an incorrect run page state.

  if (loopRun.status === "queued") {
    const transitioned = await conditionallyTransitionRunStatus({
      runId: loopRunId,
      toStatus: "running",
      fromStatuses: ["queued"],
    });

    if (!transitioned) {
      // Status changed between load and this call (race: cancel/stall landed).
      // Treat as a cooperative skip — emit an event and return without executing.
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId: ctx.stepRun.nodeId,
        eventName: "agent-loop.chain.skipped",
        status: "info",
        level: "info",
        summary:
          "Chain skipped: run status changed before queued→running transition (cancel race)",
        payload: { reason: "queued_to_running_race", stepRunId },
        workflowRunId,
      });
      return;
    }

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

  // Parse user guardrails from the loop config (JSONB, may be null).
  //
  // #879: guardrails can also be embedded inside the run's definitionSnapshot
  // (persisted by clients PATCHing {definition:{...,guardrails}}, which never
  // boundary-validates the embedded object). The agent_loops.guardrails
  // column remains the canonical, boundary-validated store — it is what the
  // UI reads — so it wins per field over anything embedded in the
  // definition; the merge only fills in fields the column left unset.
  const columnGuardrails = loop.guardrails as Partial<LoopGuardrails> | null;
  const definitionGuardrails = extractDefinitionGuardrails(
    loopRun.definitionSnapshot,
  );
  const guardrails = resolveGuardrails({
    ...definitionGuardrails,
    ...columnGuardrails,
  });
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

    const guardrailErrorMessage = `Guardrail exceeded: ${whichGuardrail}`;
    const guardrailWinner = await conditionallyTransitionRunStatus({
      runId: loopRunId,
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "guardrail_exceeded",
      errorMessage: guardrailErrorMessage,
    });
    if (!guardrailWinner) return;

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

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.run.failed",
      status: "failed",
      level: "error",
      summary: guardrailErrorMessage,
      payload: { errorKind: "guardrail_exceeded", whichGuardrail },
      workflowRunId,
    });

    return;
  }

  // ── 5. Execute the step ────────────────────────────────────────────────────

  let result: Awaited<ReturnType<typeof executeAgentLoopStep>>;
  try {
    result = await executeAgentLoopStep({
      stepRunId,
      workflowRunId,
      stepTimeoutMs: guardrails.stepTimeoutMs,
      maxAgentTurnsPerStep: guardrails.maxAgentTurnsPerStep,
    });
  } catch (error) {
    // Workflow steps retry uncaught errors. That is useful for transient
    // failures, but unsafe here: this chain entrypoint has already claimed
    // the app-level step and the retry would restart its deadline while
    // leaving the run looking permanently active. Convert unexpected executor
    // errors into the same durable failure evidence as a typed step failure.
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureUpdated = await updateAgentLoopStepRun({
      stepRunId,
      status: "failed",
      errorKind: "workflow_failed",
      errorMessage,
      finishedAt: new Date(),
      durationMs: Math.max(
        0,
        Date.now() - (ctx.stepRun.startedAt?.getTime() ?? Date.now()),
      ),
      expectedStatuses: ["queued", "running"],
      ...(ctx.stepRun.workflowRunId
        ? { expectedWorkflowRunId: workflowRunId }
        : {}),
    });
    if (failureUpdated) {
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.step.failed",
        status: "failed",
        level: "error",
        summary: errorMessage,
        payload: {
          errorKind: "workflow_failed",
          errorMessage,
          nodeKind: ctx.stepRun.nodeKind,
          attempt: ctx.stepRun.attempt,
        },
        workflowRunId,
      });
    }

    const failed = await conditionallyTransitionRunStatus({
      runId: loopRunId,
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "workflow_failed",
      errorMessage,
    });
    if (failed) {
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.run.failed",
        status: "failed",
        level: "error",
        summary: errorMessage,
        payload: { errorKind: "workflow_failed", errorMessage },
        workflowRunId,
      });
    }
    return;
  }

  if (result.outcome === "replay") return;

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
  // The executor's end-node path owns the completion transition.
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
  //
  // If the run was STALLED during execution (sweep marked it stalled while the
  // in-flight step was still running), we apply the same bookkeeping-yes /
  // dispatch-no treatment.  The operator's recovery path (retryCurrentStep) will
  // re-dispatch the queued currentStepRunId.  A stalled_before_dispatch event is
  // emitted with runStatus="stalled" in the payload for observability.

  const pausedMidExecution = postExecStatus === "paused";
  const stalledMidExecution = postExecStatus === "stalled";

  await advanceLoopRun({
    stepRunId,
    workflowRunId,
    loopRunId,
    nodeId,
    definition,
    outcome: result.outcome,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
    attempt: ctx.stepRun.attempt,
    currentStepCount: loopRun.stepCount,
    currentIterationCount: loopRun.iterationCount,
    nodeKind: node?.kind ?? "unknown",
    loop,
    loopRun,
    pausedMidExecution,
    stalledMidExecution,
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
  /** The error message from the step executor result — forwarded to watchdog for diagnosis context. */
  errorMessage?: string;
  /** The step attempt number — forwarded to watchdog for diagnosis context and persisted in the watchdog row. */
  attempt: number;
  currentStepCount: number;
  currentIterationCount: number;
  nodeKind: string;
  /** Snapshot-derived loop policy threaded through for watchdog invocation. */
  loop: Parameters<typeof invokeWatchdog>[0]["loop"];
  /** The full loop run — threaded through for watchdog invocation on failure. */
  loopRun: import("@/lib/db/schema").AgentLoopRun;
  /**
   * True when the run was paused DURING step execution (i.e. the pause landed
   * between executeAgentLoopStep starting and returning).  Advance bookkeeping
   * is still performed so that currentStepRunId points at the queued next step,
   * but the workflow dispatch is suppressed — resumeLoopRun re-dispatches it.
   */
  pausedMidExecution?: boolean;
  /**
   * True when the sweep marked the run stalled DURING step execution (i.e. the
   * stall landed between executeAgentLoopStep starting and returning).  Advance
   * bookkeeping is still performed (the step's completed work is preserved and
   * currentStepRunId is updated to the queued next step), but the workflow
   * dispatch is suppressed — retryCurrentStep will re-dispatch the queued step.
   * A stalled_before_dispatch event is emitted with runStatus="stalled" visible
   * in the payload.
   */
  stalledMidExecution?: boolean;
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
    errorMessage,
    attempt,
    currentStepCount,
    currentIterationCount,
    nodeKind,
    loop,
    loopRun,
    pausedMidExecution = false,
    stalledMidExecution = false,
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
      // Failed step with no failure edge.
      // Branch: watchdog enabled → invoke watchdog (which owns the resulting state).
      //         watchdog disabled → fail-fast (existing M1 behavior, byte-for-byte).
      const loopWithWatchdog = loop as typeof loop & {
        watchdogEnabled?: boolean;
        watchdogInstructions?: string | null;
        watchdogRetryBudget?: number;
      };
      const watchdogEnabled = loopWithWatchdog.watchdogEnabled === true;

      if (watchdogEnabled) {
        // Watchdog path: invoke watchdog; it owns the run's resulting state.
        // If invokeWatchdog itself throws (a watchdog bug), fall back to fail-fast
        // so a watchdog bug never permanently wedges a run.
        try {
          const watchdogResult = await invokeWatchdog({
            loop: loop as Parameters<typeof invokeWatchdog>[0]["loop"],
            loopRun,
            stepRunId,
            nodeId,
            nodeKind,
            attempt,
            errorKind,
            errorMessage:
              errorMessage ?? `Step failed with no failure edge: ${nodeId}`,
            workflowRunId,
          });
          if (!watchdogResult.invoked) {
            const revoked = await conditionallyTransitionRunStatus({
              runId: loopRunId,
              toStatus: "failed",
              fromStatuses: ["queued", "running", "stalled"],
              errorKind: "execution_revoked",
              errorMessage:
                "Loop execution authorization was revoked before watchdog action.",
            });
            if (revoked) {
              await recordAgentLoopEvent({
                loopRunId,
                stepRunId,
                nodeId,
                eventName: "agent-loop.execution.revoked",
                status: "failed",
                level: "error",
                summary: "Loop execution authorization was revoked.",
                payload: { errorKind: "execution_revoked" },
                workflowRunId,
              });
            }
          }
          // Watchdog owns the state — do not also mark failed.
          return;
        } catch (watchdogErr) {
          // Watchdog threw unexpectedly — fall through to fail-fast below.
          console.error(
            "[agent-loop.chain] Watchdog threw; falling back to fail-fast",
            watchdogErr,
          );
        }
      }

      // Default sink (watchdog disabled or watchdog threw): a failed step with
      // no failure edge has nowhere to route, so the run terminates as failed.
      // Surface the step's actual error (errorKind/errorMessage) as the run's
      // error instead of masking it with a generic "no failure edge" string —
      // the underlying cause (e.g. "Agent step failed: Tool result is missing
      // …") is what the operator needs. Fall back to the routing message only
      // when the step provided no error detail.
      const resolvedErrorKind = errorKind ?? "step_failed";
      const noFailureEdgeMessage = `Step failed with no failure edge: ${nodeId}`;
      const resolvedErrorMessage = errorMessage ?? noFailureEdgeMessage;

      const failed = await conditionallyTransitionRunStatus({
        runId: loopRunId,
        toStatus: "failed",
        fromStatuses: ["queued", "running", "stalled"],
        errorKind: resolvedErrorKind,
        errorMessage: resolvedErrorMessage,
      });
      if (!failed) return;

      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.run.failed",
        status: "failed",
        level: "error",
        summary: resolvedErrorMessage,
        payload: {
          errorKind: resolvedErrorKind,
          errorMessage: resolvedErrorMessage,
          nodeId,
          // The failure was unhandled by the graph (no failure edge) and routed
          // to the implicit default sink that terminates the run.
          routedToDefaultSink: true,
          noFailureEdge: true,
        },
        workflowRunId,
      });
    } else {
      // Successful/true/false outcome with no matching edge (dangling or graph gap)
      const routeMissingMsg = `No outgoing edge from '${nodeId}' for outcome '${outcome}' (dangling or missing edge)`;
      const failed = await conditionallyTransitionRunStatus({
        runId: loopRunId,
        toStatus: "failed",
        fromStatuses: ["queued", "running", "stalled"],
        errorKind: "chain_route_missing",
        errorMessage: routeMissingMsg,
      });
      if (!failed) return;

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

      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.run.failed",
        status: "failed",
        level: "error",
        summary: routeMissingMsg,
        payload: {
          errorKind: "chain_route_missing",
          errorMessage: routeMissingMsg,
          nodeId,
          outcome,
        },
        workflowRunId,
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

  let advanceResult: Awaited<ReturnType<typeof createAndAdvanceAgentLoopStep>>;
  try {
    advanceResult = await createAndAdvanceAgentLoopStep({
      runId: loopRunId,
      fromStepRunId: stepRunId,
      nextNodeId,
      nextNodeKind,
      attempt: nextAttempt,
      stepCount: newStepCount,
      iterationCount: newIterationCount,
      workflowRunId,
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

  if (advanceResult.outcome === "source_deleted") {
    return;
  }

  if (advanceResult.outcome === "duplicate") {
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

  const nextStepRun = advanceResult.step;

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

  // ── 7g-stall. Stall mid-execution: bookkeeping done, skip dispatch ────────
  //
  // If the sweep marked the run stalled DURING step execution, the bookkeeping
  // above (edge evaluated, step run created, advanceRunToNextStep pointer update)
  // preserves the completed work.  We must NOT dispatch the workflow — the run
  // is stalled and retryCurrentStep will detect the QUEUED currentStepRunId and
  // re-dispatch it without creating a new attempt.
  //
  // We emit a distinct stalled_before_dispatch event (not paused_before_dispatch)
  // so observability tooling can distinguish the two cases.  runStatus is
  // included in the payload so the event is self-describing.
  if (stalledMidExecution) {
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.chain.stalled_before_dispatch",
      status: "info",
      level: "warn",
      summary: `Chain stalled before dispatch of next step ${nextNodeId}; retryCurrentStep will re-dispatch`,
      payload: {
        nextNodeId,
        nextStepRunId: nextStepRun.id,
        nodeKind: nextNodeKind,
        runStatus: "stalled",
      },
      workflowRunId,
    });
    return;
  }

  // ── 7h. Dispatch next step workflow ────────────────────────────────────────

  if (
    !(await isAgentLoopRunSourceLive(loopRunId, {
      repoOwner: loop.repoOwner,
      repoName: loop.repoName,
    }))
  ) {
    const revoked = await conditionallyTransitionRunStatus({
      runId: loopRunId,
      toStatus: "failed",
      fromStatuses: ["queued", "running", "stalled"],
      errorKind: "execution_revoked",
      errorMessage: "Loop execution authorization was revoked before dispatch.",
    });
    if (revoked) {
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId,
        eventName: "agent-loop.execution.revoked",
        status: "failed",
        level: "error",
        summary: "Loop execution authorization was revoked before dispatch.",
        payload: { errorKind: "execution_revoked" },
        workflowRunId,
      });
    }
    return;
  }

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
