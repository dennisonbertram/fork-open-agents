/**
 * Agent Loops — run-controls (M1-08, route-side control plane)
 *
 * Pause/cancel/resume/retry for loop runs, called from API route handlers.
 *
 * These functions intentionally do NOT carry "use step" — they are route-side
 * concerns and must not be compiled into the workflow graph.
 *
 * "use step" investigation (TASK-327):
 *   The four control functions in chain.ts have "use step" because they are
 *   reachable from the workflow body (runAgentLoopStep is a "use step" function
 *   and the DevKit requires all its callees to also be marked). However,
 *   route handlers are NOT workflow bodies, so calling "use step" functions
 *   from routes is technically safe at runtime — the directive is a compile-time
 *   annotation only. To be completely safe and follow the instruction to split,
 *   we implement the control plane here by calling the store functions directly
 *   (the same underlying logic as chain.ts, but without the workflow directive).
 *   This also ensures the workflow graph cannot accidentally import this module.
 *
 *   For resume and retry, we dispatch the next workflow step using a static
 *   import of the workflow file (the proven house pattern from dispatcher-bridge.ts).
 */

import "server-only";

import { start } from "workflow/api";
import { runAgentLoopStepWorkflow } from "@/app/workflows/agent-loop-step";
import {
  pauseLoopRun as storePauseLoopRun,
  cancelLoopRun as storeCancelLoopRun,
  resumeLoopRun as storeResumeLoopRun,
  retryCurrentStep as storeRetryCurrentStep,
  recordAgentLoopEvent,
} from "./store";

/**
 * Pauses a running or queued loop run (cooperative — takes effect at next step boundary).
 * Throws on illegal transition or ownership miss (same error shape as store).
 */
export async function pauseLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  await storePauseLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.paused",
    status: "info",
    level: "info",
    summary: "Loop run paused (via API)",
    payload: { runId, userId, source: "api" },
  });
}

/**
 * Cancels a running, queued, or paused loop run.
 * Throws on illegal transition or ownership miss.
 */
export async function cancelLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  await storeCancelLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.cancelled",
    status: "info",
    level: "info",
    summary: "Loop run cancelled (via API)",
    payload: { runId, userId, source: "api" },
  });
}

/**
 * Resumes a paused loop run and re-dispatches its queued current step.
 * Throws if the run is not paused or ownership miss.
 */
export async function resumeLoopRun(
  runId: string,
  userId: string,
): Promise<void> {
  const run = await storeResumeLoopRun(runId, userId);

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.resumed",
    status: "info",
    level: "info",
    summary: "Loop run resumed (via API)",
    payload: { runId, userId, source: "api" },
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
        payload: {
          stepRunId: run.currentStepRunId,
          resumed: true,
          source: "api",
        },
      });
    } catch (err) {
      await recordAgentLoopEvent({
        loopRunId: runId,
        eventName: "agent-loop.chain.dispatch_failed",
        status: "failed",
        level: "error",
        summary: "Failed to re-dispatch step on resume (via API)",
        payload: {
          stepRunId: run.currentStepRunId,
          error: err instanceof Error ? err.message : String(err),
          source: "api",
        },
      });
    }
  }
}

/**
 * Retries the current (failed or stalled) step of a loop run.
 * Creates attempt n+1 of the current node and dispatches its workflow.
 * Throws if the run is not in a retryable status or ownership miss.
 */
export async function retryCurrentStep(
  runId: string,
  userId: string,
): Promise<void> {
  const newStepRun = await storeRetryCurrentStep({ runId, userId });

  await recordAgentLoopEvent({
    loopRunId: runId,
    eventName: "agent-loop.run.retry",
    status: "info",
    level: "info",
    summary: `Retrying step: attempt ${newStepRun.attempt} (via API)`,
    payload: {
      runId,
      userId,
      newStepRunId: newStepRun.id,
      attempt: newStepRun.attempt,
      source: "api",
    },
  });

  try {
    await start(runAgentLoopStepWorkflow, [{ stepRunId: newStepRun.id }]);

    await recordAgentLoopEvent({
      loopRunId: runId,
      eventName: "agent-loop.chain.dispatched",
      status: "info",
      level: "info",
      summary: `Dispatched retry step: ${newStepRun.nodeId} attempt ${newStepRun.attempt}`,
      payload: {
        stepRunId: newStepRun.id,
        attempt: newStepRun.attempt,
        source: "api",
      },
    });
  } catch (err) {
    await recordAgentLoopEvent({
      loopRunId: runId,
      eventName: "agent-loop.chain.dispatch_failed",
      status: "failed",
      level: "error",
      summary: "Failed to dispatch retry step (via API)",
      payload: {
        stepRunId: newStepRun.id,
        error: err instanceof Error ? err.message : String(err),
        source: "api",
      },
    });
  }
}
