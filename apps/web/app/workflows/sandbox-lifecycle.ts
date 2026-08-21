import { sleep } from "workflow";
import { SANDBOX_LIFECYCLE_MIN_SLEEP_MS } from "@/lib/sandbox/config";
import type {
  SandboxLifecycleEvaluationResult,
  SandboxLifecycleReason,
} from "@/lib/sandbox/lifecycle";

interface LifecycleWakeDecision {
  shouldContinue: boolean;
  wakeAtMs?: number;
  reason?: string;
}

async function claimLifecycleLease(
  sessionId: string,
  runId: string,
): Promise<boolean> {
  const { getSessionById, updateSession } = await import("@/lib/db/sessions");
  const current = await getSessionById(sessionId);
  if (!current) {
    return false;
  }

  if (current.lifecycleRunId && current.lifecycleRunId !== runId) {
    return false;
  }

  if (current.lifecycleRunId !== runId) {
    await updateSession(sessionId, { lifecycleRunId: runId });
  }

  const verified = await getSessionById(sessionId);
  return verified?.lifecycleRunId === runId;
}

async function computeLifecycleWakeDecision(
  sessionId: string,
  runId: string,
): Promise<LifecycleWakeDecision> {
  "use step";

  const { getSessionById } = await import("@/lib/db/sessions");
  const { getLifecycleDueAtMs } = await import("@/lib/sandbox/lifecycle");
  const { canOperateOnSandbox } = await import("@/lib/sandbox/utils");
  const session = await getSessionById(sessionId);
  if (!session) {
    return { shouldContinue: false, reason: "session-not-found" };
  }
  if (session.status === "archived" || session.lifecycleState === "archived") {
    const archivedState = session.sandboxState;
    if (
      !canOperateOnSandbox(archivedState) ||
      archivedState.type !== "vercel"
    ) {
      return { shouldContinue: false, reason: "session-archived" };
    }
    // #1395: the session is archived but still holds a live resume handle —
    // the archive-time stop failed. Wake immediately so the evaluation pass
    // retries the stop instead of orphaning the VM.
    if (!(await claimLifecycleLease(sessionId, runId))) {
      return { shouldContinue: false, reason: "run-replaced" };
    }
    return { shouldContinue: true, wakeAtMs: Date.now() };
  }

  const state = session.sandboxState;
  if (!canOperateOnSandbox(state) || state.type !== "vercel") {
    return { shouldContinue: false, reason: "sandbox-not-operable" };
  }
  if (!(await claimLifecycleLease(sessionId, runId))) {
    return { shouldContinue: false, reason: "run-replaced" };
  }

  return {
    shouldContinue: true,
    wakeAtMs: getLifecycleDueAtMs(session),
  };
}

async function runLifecycleEvaluation(
  sessionId: string,
  reason: SandboxLifecycleReason,
): Promise<SandboxLifecycleEvaluationResult> {
  "use step";
  const { evaluateSandboxLifecycle } = await import("@/lib/sandbox/lifecycle");
  return evaluateSandboxLifecycle(sessionId, reason);
}

async function clearLifecycleRunIdIfOwned(
  sessionId: string,
  runId: string,
): Promise<void> {
  "use step";

  const { getSessionById, updateSession } = await import("@/lib/db/sessions");
  const session = await getSessionById(sessionId);
  if (!session || session.lifecycleRunId !== runId) {
    return;
  }

  await updateSession(sessionId, { lifecycleRunId: null });
}

export async function sandboxLifecycleWorkflow(
  sessionId: string,
  reason: SandboxLifecycleReason,
  runId: string,
) {
  "use workflow";
  while (true) {
    const decision = await computeLifecycleWakeDecision(sessionId, runId);
    if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
      await clearLifecycleRunIdIfOwned(sessionId, runId);
      return { skipped: true, reason: decision.reason ?? "no-decision" };
    }

    const now = Date.now();
    const wakeAtMs = Math.max(
      decision.wakeAtMs,
      now + SANDBOX_LIFECYCLE_MIN_SLEEP_MS,
    );
    await sleep(new Date(wakeAtMs));

    const evaluation = await runLifecycleEvaluation(sessionId, reason);

    if (
      evaluation.action === "skipped" &&
      (evaluation.reason === "not-due-yet" ||
        evaluation.reason === "active-workflow" ||
        evaluation.reason === "snapshot-already-in-progress")
    ) {
      continue;
    }

    // #1395: a retried archive stop that failed again must not end the run —
    // the resume handle is still live, so keep looping (spaced by the minimum
    // sleep) until the stop succeeds.
    if (
      evaluation.action === "failed" &&
      evaluation.reason === "archive-stop-retry-failed"
    ) {
      continue;
    }

    await clearLifecycleRunIdIfOwned(sessionId, runId);
    return { skipped: false, evaluation };
  }
}
