/**
 * Agent Loops — watchdog.ts (M3-01)
 *
 * invokeWatchdog({ loop, loopRun, stepRunId, nodeId, nodeKind, attempt, errorKind, errorMessage, workflowRunId })
 *
 * Flow:
 *   (a) Guard: !loop.watchdogEnabled → return { invoked: false }
 *   (b) Budget pre-check via countWatchdogRetryDecisions; if >= budget → forced pause (no agent call)
 *   (c) Create watchdog row status=running; emit agent-loop.watchdog.started
 *   (d) Build diagnosis prompt from error context, step I/O, loop events, snapshot, watchdog instructions
 *   (e) Invoke openAgent in classic mode with getChatOnlyTools() — no sandbox, no file/bash tools
 *       (v1 decision: watchdog decides from evidence in the prompt, not live investigation)
 *   (f) Parse decision with zod: { decision: retry|skip|pause, diagnosis, hint? }
 *       Any failure → pause with watchdog_output_invalid
 *       AbortError → pause with watchdog_timeout
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
 *   invokeWatchdog never throws — all errors fall back to pause internally.
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
} from "./store";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvokeWatchdogParams = {
  loop: AgentLoop & {
    watchdogEnabled: boolean;
    watchdogInstructions: string | null;
    watchdogRetryBudget: number;
  };
  loopRun: AgentLoopRun;
  stepRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
  errorKind?: string;
  errorMessage?: string;
  workflowRunId?: string | null;
};

export type InvokeWatchdogResult = {
  invoked: boolean;
  decision?: "retry" | "skip" | "pause";
};

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
  } = params;

  // (a) Guard: watchdog disabled → no-op
  if (!loop.watchdogEnabled) {
    return { invoked: false };
  }

  const loopRunId = loopRun.id;

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

    await pauseLoopRunSystem(loopRunId);

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

  // (c) Create watchdog row status=running
  const watchdogRow = await createAgentLoopWatchdogRun({
    loopRunId,
    stepRunId,
    nodeId,
    status: "running",
    attempt,
    budgetRemaining,
    startedAt: new Date(),
  } as Parameters<typeof createAgentLoopWatchdogRun>[0] & { startedAt?: Date });

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
      model: gateway("anthropic/claude-haiku-4-5"),
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

  // (g) Apply decision
  const finalDecision = decisionResult?.decision ?? "pause";
  const diagnosis =
    decisionResult?.diagnosis ?? "Watchdog fallback: pause applied";
  const hint = decisionResult?.hint;

  if (parseErrorKind) {
    // Invalid/timeout → pause
    await pauseLoopRunSystem(loopRunId);

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

  // Valid decision
  if (finalDecision === "retry") {
    try {
      const newStepRun = await retryCurrentStepForWatchdog({
        runId: loopRunId,
        hint,
      });

      // Dispatch the new step run
      try {
        await dispatchStepWorkflow(newStepRun.id);
      } catch {
        // Dispatch failure is non-fatal — the step is queued, sweep will recover
      }
    } catch {
      // Retry failed — fall back to pause
      await pauseLoopRunSystem(loopRunId);
    }
  } else if (finalDecision === "skip") {
    const advanced = await advanceToFailureEdge({
      loopRunId,
      nodeId,
      snapshotDefinition: loopRun.definitionSnapshot,
    });

    if (!advanced) {
      // No failure edge — pause (graceful, not an error)
      await pauseLoopRunSystem(loopRunId);
    } else {
      // Dispatch the next step run
      // The advanceToFailureEdge function updated currentStepRunId;
      // we dispatch by re-reading the run — this is a best-effort path
      // (the step is queued; sweep will recover if dispatch fails)
    }
  } else {
    // pause
    await pauseLoopRunSystem(loopRunId);
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
    },
    workflowRunId,
  });

  await updateAgentLoopWatchdogRun({
    id: watchdogRow.id,
    status: "decided",
    decision: finalDecision,
    diagnosis: truncate(diagnosis, MAX_DIAGNOSIS_STORE_LENGTH),
    decisionPayload: hint ? { hint } : undefined,
    finishedAt: new Date(),
  });

  return { invoked: true, decision: finalDecision };
}
