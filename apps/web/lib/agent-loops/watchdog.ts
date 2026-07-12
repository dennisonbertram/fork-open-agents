/**
 * Agent Loops — watchdog.ts (M3-01)
 *
 * invokeWatchdog({ loop, loopRun, stepRunId, nodeId, nodeKind, attempt, errorKind, errorMessage, workflowRunId })
 * invokeWatchdogForStall({ ...invokeWatchdogParams, legalDecisions?: ['retry','pause'] })
 *
 * Flow:
 *   (a) Guard: !loop.watchdogEnabled → return { invoked: false }
 *   (b) Budget pre-check via countWatchdogRetryDecisions; if >= budget → forced pause (no agent call)
 *   (c) Create watchdog row status=running; emit agent-loop.watchdog.started
 *   (d) Build diagnosis prompt from error context, step I/O, loop events, snapshot, watchdog instructions
 *   (e) Call generateText with gateway("anthropic/claude-haiku-4.5") — read-only, evidence-in-prompt only
 *       (no tools, no sandbox in v1)
 *   (f) Parse decision with zod: { decision: retry|skip|pause, diagnosis, hint? }
 *       Any failure → pause with watchdog_output_invalid
 *       AbortError → pause with watchdog_timeout
 *       If parsed decision is not in legalDecisions, coerce to 'pause'
 *   (g) Apply:
 *       retry → retryCurrentStepForWatchdog (hint persisted in stepInput)
 *       skip → advanceToFailureEdge from snapshot; if no failure edge → pause
 *       pause → pauseLoopRunSystem
 *   (h) Emit agent-loop.watchdog.decided (info for retry/skip, warn for pause)
 *       Update watchdog row to decided with decision/diagnosis/finishedAt
 *
 * Events emitted:
 *   agent-loop.watchdog.started — before agent call (info)
 *   agent-loop.watchdog.decided — after decision applied (info for retry/skip, warn for pause)
 *
 * Error contract:
 *   invokeWatchdog / invokeWatchdogForStall never throw — all errors fall back to pause internally.
 *   The chain.ts caller must additionally wrap in try/catch and fall back to
 *   fail-fast if this function itself throws (defense-in-depth).
 */

import "server-only";

import { generateText } from "ai";
import { z } from "zod";
import { gateway } from "@open-agents/agent";
import {
  createAgentLoopWatchdogRun,
  updateAgentLoopWatchdogRun,
  countWatchdogRetryDecisions,
  retryCurrentStepForWatchdog,
  pauseLoopRunSystem,
  advanceToFailureEdge,
  dispatchStepWorkflow,
  recordAgentLoopEvent,
  isAgentLoopRunSourceLive,
} from "./store";
import type { AgentLoopRun } from "@/lib/db/schema";
import type { AgentLoopExecutionPolicy } from "./execution-snapshot";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvokeWatchdogParams = {
  loop: Pick<
    AgentLoopExecutionPolicy,
    | "repoOwner"
    | "repoName"
    | "watchdogEnabled"
    | "watchdogInstructions"
    | "watchdogRetryBudget"
  >;
  loopRun: AgentLoopRun;
  stepRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
  errorKind?: string;
  errorMessage?: string;
  workflowRunId?: string | null;
  /**
   * Which decisions are legal for this invocation.
   * Defaults to all three: ['retry', 'skip', 'pause'].
   * For stall-sweep invocations, pass ['retry', 'pause'] to coerce an
   * illegal 'skip' to 'pause' (a stalled run has no live failure edge to skip to).
   */
  legalDecisions?: ReadonlyArray<"retry" | "skip" | "pause">;
};

export type InvokeWatchdogResult = {
  invoked: boolean;
  decision?: "retry" | "skip" | "pause";
};

async function finalizeWatchdogRaceLost(
  watchdogRunId: string,
): Promise<InvokeWatchdogResult> {
  await updateAgentLoopWatchdogRun({
    id: watchdogRunId,
    status: "failed",
    diagnosis: "Run state changed before the watchdog decision could apply.",
    finishedAt: new Date(),
  });
  return { invoked: false };
}

// ── Decision schema ───────────────────────────────────────────────────────────

const watchdogDecisionSchema = z.object({
  decision: z.enum(["retry", "skip", "pause"]),
  diagnosis: z.string(),
  hint: z.string().optional(),
});

// ── Constants ──────────────────────────────────────────────────────────────────

/** Max diagnosis length to store (truncated before persist) */
const MAX_DIAGNOSIS_STORE_LENGTH = 2000;

/** Max diagnosis length in watchdog.decided event payload */
const MAX_DIAGNOSIS_EVENT_LENGTH = 500;

/** Watchdog agent timeout (3 minutes) */
const WATCHDOG_AGENT_TIMEOUT_MS = 3 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}...[truncated]`;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message.toLowerCase().includes("aborted"))
  );
}

/**
 * Builds the diagnosis prompt for the watchdog agent.
 * The agent's role: analyse the failure evidence and decide retry/skip/pause.
 * v1 design decision: read-only, evidence-in-prompt only (no sandbox/live tools).
 */
function buildWatchdogPrompt(params: {
  nodeId: string;
  nodeKind: string;
  attempt: number;
  errorKind?: string;
  errorMessage?: string;
  stepInput: unknown;
  stepOutput: unknown;
  watchdogInstructions: string | null;
  loopRunId: string;
}): string {
  const errorSection = `## Failed Step Information

- **Node ID**: ${params.nodeId}
- **Node Kind**: ${params.nodeKind}
- **Attempt**: ${params.attempt}
- **Error Kind**: ${params.errorKind ?? "(none)"}
- **Error Message**: ${params.errorMessage ?? "(none)"}
`;

  const stepInputStr = params.stepInput
    ? `\`\`\`json\n${JSON.stringify(params.stepInput, null, 2).slice(0, 2000)}\n\`\`\``
    : "(no step input)";

  const stepOutputStr = params.stepOutput
    ? `\`\`\`json\n${JSON.stringify(params.stepOutput, null, 2).slice(0, 2000)}\n\`\`\``
    : "(no step output)";

  const inputOutputSection = `## Step Input\n\n${stepInputStr}\n\n## Step Output\n\n${stepOutputStr}\n`;

  const instructionsSection = params.watchdogInstructions
    ? `## Standing Watchdog Instructions\n\n${params.watchdogInstructions}\n`
    : "";

  const decisionSection = `## Your Task

Analyse the failed step and decide what to do:

- **retry**: The step can be retried, possibly with a corrective hint. Use when the failure is transient or when you have actionable guidance.
- **skip**: Skip this step and proceed along the failure edge (if one exists). Use when the step is not critical or can be safely bypassed.
- **pause**: Pause the run and require human attention. Use when the failure is unrecoverable or unclear.

Respond with a JSON object (no markdown wrapping):
\`\`\`
{
  "decision": "retry" | "skip" | "pause",
  "diagnosis": "Brief diagnosis of the failure (1-2 sentences)",
  "hint": "Optional: actionable guidance for the retry attempt (omit for skip/pause)"
}
\`\`\`

IMPORTANT: Respond with ONLY the JSON object. No prose, no markdown fences around it.
`;

  return [
    `# Watchdog: Agent Loop Step Failure Diagnosis`,
    "",
    `You are an autonomous watchdog analysing a failed agent loop step (run: ${params.loopRunId}).`,
    "Your job is to diagnose the failure and decide whether to retry, skip, or pause the run.",
    "",
    errorSection,
    inputOutputSection,
    instructionsSection,
    decisionSection,
  ].join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Diagnoses a failed step and applies a watchdog decision (retry/skip/pause).
 *
 * Never throws — all errors fall back to pause internally.
 * The chain.ts caller additionally wraps in try/catch for defense-in-depth.
 */
export async function invokeWatchdog(
  params: InvokeWatchdogParams,
): Promise<InvokeWatchdogResult> {
  const {
    loop,
    loopRun,
    stepRunId,
    nodeId,
    nodeKind,
    attempt,
    errorKind,
    errorMessage,
    workflowRunId,
    legalDecisions = ["retry", "skip", "pause"],
  } = params;

  // (a) Guard: watchdog disabled → no-op
  if (!loop.watchdogEnabled) {
    return { invoked: false };
  }

  const loopRunId = loopRun.id;
  const isExecutionAllowed = () =>
    isAgentLoopRunSourceLive(loopRunId, {
      repoOwner: loop.repoOwner,
      repoName: loop.repoName,
    });

  if (!(await isExecutionAllowed())) {
    return { invoked: false };
  }

  // (b) Budget pre-check
  const priorRetries = await countWatchdogRetryDecisions({ loopRunId, nodeId });
  const budget = loop.watchdogRetryBudget;
  const budgetRemaining = budget - priorRetries;

  // Emit watchdog.started before any decision path
  await recordAgentLoopEvent({
    loopRunId,
    stepRunId,
    nodeId,
    eventName: "agent-loop.watchdog.started",
    status: "info",
    level: "info",
    summary: `Watchdog started for node ${nodeId} attempt ${attempt}`,
    payload: {
      loopRunId,
      stepRunId,
      nodeId,
      attempt,
      budgetRemaining,
      errorKind: errorKind ?? null,
    },
    workflowRunId,
  });

  if (priorRetries >= budget) {
    // Budget exhausted — create row already decided, apply pause
    const diagnosis = `Retry budget exhausted (${priorRetries}/${budget}) for node ${nodeId}`;
    const watchdogRow = await createAgentLoopWatchdogRun({
      loopRunId,
      stepRunId,
      nodeId,
      status: "decided",
      attempt,
      budgetRemaining: 0,
      decision: "pause",
      diagnosis: truncate(diagnosis, MAX_DIAGNOSIS_STORE_LENGTH),
    });

    if (!(await pauseLoopRunSystem(loopRunId))) {
      return finalizeWatchdogRaceLost(watchdogRow.id);
    }

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.watchdog.decided",
      status: "info",
      level: "warn",
      summary: diagnosis,
      payload: {
        decision: "pause",
        diagnosis: truncate(diagnosis, MAX_DIAGNOSIS_EVENT_LENGTH),
        hasHint: false,
        budgetRemaining: 0,
        reason: "budget_exhausted",
      },
      workflowRunId,
    });

    await updateAgentLoopWatchdogRun({
      id: watchdogRow.id,
      finishedAt: new Date(),
    });

    return { invoked: true, decision: "pause" };
  }

  // (c) Create watchdog row status=running — startedAt persisted for duration tracking (M3-01 follow-up B)
  const watchdogRow = await createAgentLoopWatchdogRun({
    loopRunId,
    stepRunId,
    nodeId,
    status: "running",
    attempt,
    budgetRemaining,
    startedAt: new Date(),
  });

  // (d) Build prompt
  // Get step input/output from the step run (best-effort — may be null)
  // We use the loopRun's context for additional context
  const prompt = buildWatchdogPrompt({
    nodeId,
    nodeKind,
    attempt,
    errorKind,
    errorMessage,
    stepInput: null, // v1: no live step run fetch in watchdog (evidence-in-prompt only)
    stepOutput: null,
    watchdogInstructions: loop.watchdogInstructions,
    loopRunId,
  });

  // (e) Invoke LLM directly — watchdog is read-only (evidence-in-prompt only, no sandbox in v1)
  let decisionResult: z.infer<typeof watchdogDecisionSchema> | null = null;
  let parseErrorKind: string | null = null;

  try {
    const agentResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      messages: [{ role: "user", content: prompt }],
      abortSignal: AbortSignal.timeout(WATCHDOG_AGENT_TIMEOUT_MS),
    });

    // (f) Parse decision
    {
      const rawText = agentResult.text ?? "";
      // Try to extract JSON from the response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        parseErrorKind = "watchdog_output_invalid";
      } else {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as unknown;
          const validated = watchdogDecisionSchema.safeParse(parsed);
          if (validated.success) {
            decisionResult = validated.data;
          } else {
            parseErrorKind = "watchdog_output_invalid";
          }
        } catch {
          parseErrorKind = "watchdog_output_invalid";
        }
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      parseErrorKind = "watchdog_timeout";
    } else {
      parseErrorKind = "watchdog_output_invalid";
    }
  }

  if (!(await isExecutionAllowed())) {
    await updateAgentLoopWatchdogRun({
      id: watchdogRow.id,
      status: "failed",
      diagnosis: "Loop execution authorization was revoked.",
      finishedAt: new Date(),
    });
    return { invoked: false };
  }

  // (g) Apply decision
  // Coerce illegal decisions: if the parsed decision is not in legalDecisions, force pause.
  // This is used by stall-sweep invocations where 'skip' is illegal (no live failure edge).
  let rawDecision = decisionResult?.decision ?? "pause";
  let diagnosisNote = "";
  if (decisionResult && !legalDecisions.includes(rawDecision)) {
    diagnosisNote = ` (${rawDecision} illegal for this invocation — coerced to pause)`;
    rawDecision = "pause";
  }
  let finalDecision = rawDecision;
  const diagnosis =
    (decisionResult?.diagnosis ?? "Watchdog fallback: pause applied") +
    diagnosisNote;
  const hint = finalDecision === "retry" ? decisionResult?.hint : undefined;

  if (parseErrorKind) {
    // Invalid/timeout → pause
    if (!(await pauseLoopRunSystem(loopRunId))) {
      return finalizeWatchdogRaceLost(watchdogRow.id);
    }

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId,
      eventName: "agent-loop.watchdog.decided",
      status: "info",
      level: "warn",
      summary: `Watchdog paused: ${parseErrorKind}`,
      payload: {
        decision: "pause",
        errorKind: parseErrorKind,
        hasHint: false,
        budgetRemaining,
      },
      workflowRunId,
    });

    await updateAgentLoopWatchdogRun({
      id: watchdogRow.id,
      status: "decided",
      decision: "pause",
      diagnosis: truncate(
        `Watchdog fallback: ${parseErrorKind}`,
        MAX_DIAGNOSIS_STORE_LENGTH,
      ),
      finishedAt: new Date(),
    });

    return { invoked: true, decision: "pause" };
  }

  // Track whether the retry branch's *store call itself* (not the subsequent
  // dispatch) threw — this must reassign finalDecision to "pause" so the
  // event/row below never records a phantom "retry" (issue #763).
  let retryDispatchFailed = false;

  // Valid decision
  if (finalDecision === "retry") {
    try {
      const newStepRun = await retryCurrentStepForWatchdog({
        runId: loopRunId,
        hint,
      });

      // Dispatch the new step run
      try {
        const dispatched = await dispatchStepWorkflow(newStepRun.id);
        if (!dispatched) {
          return finalizeWatchdogRaceLost(watchdogRow.id);
        }

        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId,
          eventName: "agent-loop.chain.dispatched",
          status: "info",
          level: "info",
          summary: `Watchdog retry: dispatched step ${newStepRun.id} (attempt ${newStepRun.attempt})`,
          payload: {
            nextStepRunId: newStepRun.id,
            nextAttempt: newStepRun.attempt,
            hasHint: Boolean(hint),
            via: "watchdog_retry",
          },
          workflowRunId,
        });
      } catch {
        // Dispatch failure is non-fatal — the step is queued, stall sweep will recover.
        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId,
          eventName: "agent-loop.chain.dispatch_failed",
          status: "failed",
          level: "error",
          summary: `Watchdog retry: failed to dispatch step ${newStepRun.id}`,
          payload: {
            nextStepRunId: newStepRun.id,
            via: "watchdog_retry",
          },
          workflowRunId,
        });
      }
    } catch {
      // retryCurrentStepForWatchdog itself threw (e.g. TOCTOU race rejected) —
      // no step run was ever created or dispatched. Fall back to pause AND
      // reassign finalDecision so the decided row/event below never claims
      // "retry" happened (issue #763 — watchdog decision integrity).
      retryDispatchFailed = true;
      finalDecision = "pause";
      if (!(await pauseLoopRunSystem(loopRunId))) {
        return finalizeWatchdogRaceLost(watchdogRow.id);
      }
    }
  } else if (finalDecision === "skip") {
    const advanceResult = await advanceToFailureEdge({
      loopRunId,
      expectedStepRunId: stepRunId,
      nodeId,
      snapshotDefinition: loopRun.definitionSnapshot,
    });

    if (advanceResult.outcome === "race_lost") {
      return finalizeWatchdogRaceLost(watchdogRow.id);
    }
    if (advanceResult.outcome === "no_failure_edge") {
      // No failure edge — pause (graceful, not an error)
      if (!(await pauseLoopRunSystem(loopRunId))) {
        return finalizeWatchdogRaceLost(watchdogRow.id);
      }
    } else {
      const advancedStepRun = advanceResult.stepRun;
      // Dispatch the queued step run that advanceToFailureEdge created
      try {
        const dispatched = await dispatchStepWorkflow(advancedStepRun.id);
        if (!dispatched) {
          return finalizeWatchdogRaceLost(watchdogRow.id);
        }

        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId,
          eventName: "agent-loop.chain.dispatched",
          status: "info",
          level: "info",
          summary: `Watchdog skip: dispatched next step ${advancedStepRun.nodeId}`,
          payload: {
            nextNodeId: advancedStepRun.nodeId,
            nextStepRunId: advancedStepRun.id,
            via: "watchdog_skip",
          },
          workflowRunId,
        });
      } catch {
        // Dispatch failure — step is queued, stall sweep will recover.
        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId,
          eventName: "agent-loop.chain.dispatch_failed",
          status: "failed",
          level: "error",
          summary: `Watchdog skip: failed to dispatch next step ${advancedStepRun.nodeId}`,
          payload: {
            nextNodeId: advancedStepRun.nodeId,
            nextStepRunId: advancedStepRun.id,
            via: "watchdog_skip",
          },
          workflowRunId,
        });
      }
    }
  } else {
    // pause
    if (!(await pauseLoopRunSystem(loopRunId))) {
      return finalizeWatchdogRaceLost(watchdogRow.id);
    }
  }

  // (h) Emit watchdog.decided
  const isRetryOrSkip = finalDecision === "retry" || finalDecision === "skip";
  const effectiveLevel = isRetryOrSkip ? "info" : "warn";

  await recordAgentLoopEvent({
    loopRunId,
    stepRunId,
    nodeId,
    eventName: "agent-loop.watchdog.decided",
    status: "info",
    level: effectiveLevel,
    summary: `Watchdog decided: ${finalDecision}`,
    payload: {
      decision: finalDecision,
      diagnosis: truncate(diagnosis, MAX_DIAGNOSIS_EVENT_LENGTH),
      hasHint: Boolean(hint),
      budgetRemaining: budgetRemaining - (finalDecision === "retry" ? 1 : 0),
      ...(retryDispatchFailed ? { retry_dispatch_failed: true } : {}),
    },
    workflowRunId,
  });

  await updateAgentLoopWatchdogRun({
    id: watchdogRow.id,
    status: "decided",
    decision: finalDecision,
    diagnosis: truncate(diagnosis, MAX_DIAGNOSIS_STORE_LENGTH),
    decisionPayload: hint && !retryDispatchFailed ? { hint } : undefined,
    finishedAt: new Date(),
  });

  return { invoked: true, decision: finalDecision };
}

/**
 * Thin wrapper around invokeWatchdog for stall-sweep invocations.
 *
 * Differences from a failure-initiated invocation:
 *   - errorKind is always 'stall_sweep'
 *   - legalDecisions defaults to ['retry', 'pause'] — 'skip' is illegal for stalls
 *     because there is no live failed-step failure edge to skip to; the LLM returning
 *     'skip' is coerced to 'pause' inside invokeWatchdog.
 *   - The stall retry MUST go through retryCurrentStepForWatchdog (the conditional
 *     MAX(attempt)+1 path) so a sweep that raced a slow-but-alive workflow cannot
 *     double-dispatch — this is inherited from invokeWatchdog's retry branch.
 *   - Budget sharing: countWatchdogRetryDecisions is the shared per-node retry counter
 *     (same table, same nodeId) so stall-initiated retries reduce the budget identically
 *     to failure-initiated retries (see store.ts comment near countWatchdogRetryDecisions).
 *
 * Never throws — all errors fall back to pause via invokeWatchdog's error contract.
 */
export async function invokeWatchdogForStall(
  params: InvokeWatchdogParams & {
    legalDecisions?: ReadonlyArray<"retry" | "skip" | "pause">;
  },
): Promise<InvokeWatchdogResult> {
  return invokeWatchdog({
    ...params,
    errorKind: params.errorKind ?? "stall_sweep",
    legalDecisions: params.legalDecisions ?? ["retry", "pause"],
  });
}
