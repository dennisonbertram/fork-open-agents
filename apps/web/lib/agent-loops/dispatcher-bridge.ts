/**
 * Agent Loops — dispatcher bridge (M1-07)
 *
 * dispatchLoopRunForTrigger — called by background-agents/dispatcher.ts when a
 * loop-bound trigger matches an event or fires on cron. Gates on feature flags,
 * allowlist, loop status, single-active-run rule, and definition validity
 * before creating a run and dispatching the first step.
 *
 * dispatchManualAgentLoopStart — for the M1-08 API route. Ownership check via
 * getOwnedAgentLoop, then same path with source "manual".
 */

import "server-only";

import { start } from "workflow/api";
import { runAgentLoopStepWorkflow } from "@/app/workflows/agent-loop-step";
import type { AgentLoop, BackgroundAgentTrigger } from "@/lib/db/schema";
import {
  createAgentLoopRun,
  createAgentLoopStepRun,
  getOwnedAgentLoop,
  hasActiveRunForLoop,
  recordAgentLoopEvent,
} from "./store";
import { isAgentLoopRepoAllowed, isAgentLoopsEnabled } from "./config";
import { validateLoopDefinition } from "./validation";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoopDispatchSkipReason =
  | "feature_disabled"
  | "repo_not_allowed"
  | "loop_inactive"
  | "loop_invalid"
  | "active_run"
  | "ownership_fail";

export type LoopDispatchResult =
  | {
      skipped: true;
      reason: LoopDispatchSkipReason;
      runId?: undefined;
      created?: undefined;
    }
  | {
      skipped?: false;
      reason?: undefined;
      created: boolean;
      runId: string;
    };

export type DispatchLoopRunForTriggerParams = {
  loop: AgentLoop;
  trigger: Pick<
    BackgroundAgentTrigger,
    "id" | "loopId" | "kind" | "conditions" | "schedule"
  >;
  event: {
    source: "github" | "schedule" | "webhook" | "manual";
    kind: string;
    externalId?: string | null;
    repoOwner?: string;
    repoName?: string;
    occurredAt?: string | null;
  };
  requestId?: string | null;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildIdempotencyKey(params: {
  loopId: string;
  triggerId: string;
  source: string;
  kind: string;
  externalId: string | null | undefined;
}): string {
  // Mirror background-agents idempotency key structure:
  // loopId:triggerId:source:kind:externalId
  return [
    params.loopId,
    params.triggerId,
    params.source,
    params.kind,
    params.externalId ?? "no-external-id",
  ].join(":");
}

// ── Core dispatch logic ───────────────────────────────────────────────────────

/**
 * Shared dispatch path used by both trigger-driven and manual dispatch.
 * Expects all gating checks (flags, allowlist, loop status) to have already
 * passed before this is called.
 */
async function dispatchLoopRun(params: {
  loop: AgentLoop;
  trigger: Pick<BackgroundAgentTrigger, "id" | "loopId" | "kind">;
  event: {
    source: "github" | "schedule" | "webhook" | "manual";
    kind: string;
    externalId?: string | null;
    occurredAt?: string | null;
  };
  idempotencyKey: string;
  requestId?: string | null;
}): Promise<LoopDispatchResult> {
  const { loop, trigger, event, idempotencyKey, requestId } = params;

  // Validate the definition snapshot (defensive — definitions are validated on write)
  const validation = validateLoopDefinition(loop.definition);
  if (!validation.ok) {
    return { skipped: true, reason: "loop_invalid" };
  }

  // Single-active-run rule
  const hasActive = await hasActiveRunForLoop(loop.id);
  if (hasActive) {
    // Record skip event with available context (no runId yet)
    await recordAgentLoopEvent({
      loopRunId: "no-run",
      eventName: "agent-loop.trigger.skipped_active_run",
      status: "info",
      level: "info",
      summary: `Trigger skipped: loop ${loop.id} already has an active run`,
      payload: {
        loopId: loop.id,
        triggerId: trigger.id,
        triggerKind: trigger.kind,
        source: event.source,
        externalId: event.externalId,
      },
      requestId: requestId ?? null,
    });
    return { skipped: true, reason: "active_run" };
  }

  // Create the run (idempotent)
  const result = await createAgentLoopRun({
    loopId: loop.id,
    userId: loop.userId,
    definitionSnapshot: loop.definition as Record<string, unknown>,
    source: event.source,
    idempotencyKey,
    triggerId: trigger.id,
    requestId: requestId ?? null,
  });

  if (!result) {
    // Ownership check failed (loop not found for userId) — should not happen
    // since the caller loaded the loop, but handle defensively.
    return { skipped: true, reason: "ownership_fail" };
  }

  if (!result.created) {
    // Duplicate delivery — return existing run without re-dispatching
    return { created: false, runId: result.run.id };
  }

  const loopRunId = result.run.id;

  // Record trigger received event
  await recordAgentLoopEvent({
    loopRunId,
    eventName: "agent-loop.trigger.received",
    status: "info",
    level: "info",
    summary: `Received ${event.kind} trigger`,
    payload: {
      loopId: loop.id,
      triggerId: trigger.id,
      triggerKind: trigger.kind,
      source: event.source,
      externalId: event.externalId,
    },
    requestId: requestId ?? null,
  });

  await recordAgentLoopEvent({
    loopRunId,
    eventName: "agent-loop.run.created",
    status: "info",
    level: "info",
    summary: `Loop run created from ${event.source} trigger`,
    payload: {
      loopId: loop.id,
      idempotencyKey,
      source: event.source,
    },
    requestId: requestId ?? null,
  });

  // Find the start node from the validated definition snapshot
  const definition = validation.definition;
  const startNode = definition.nodes.find((n) => n.kind === "start");
  if (!startNode) {
    // Validated definitions always have exactly one start node; this path is
    // theoretically unreachable (validation enforces it), but we guard it
    // to avoid a stuck run. Return created:true so the caller can surface
    // the run; the stall sweep (M1-10) will detect the stuck-queued state.
    return { created: true, runId: loopRunId };
  }

  // Create the first step run
  const stepRun = await createAgentLoopStepRun({
    loopRunId,
    nodeId: startNode.id,
    nodeKind: startNode.kind,
    attempt: 1,
  });

  // Dispatch the first step workflow.
  // Dynamic import breaks the cycle: dispatcher-bridge.ts → agent-loop-step.ts → chain.ts → dispatcher-bridge.ts
  // The workflow file imports runAgentLoopStep from chain.ts, which in turn is used here.
  // Static import of agent-loop-step would create a module-resolution problem in tests.
  try {
    await start(runAgentLoopStepWorkflow, [{ stepRunId: stepRun.id }]);

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId: stepRun.id,
      nodeId: startNode.id,
      eventName: "agent-loop.chain.dispatched",
      status: "info",
      level: "info",
      summary: `Dispatched start node step: ${startNode.id}`,
      payload: {
        stepRunId: stepRun.id,
        nodeId: startNode.id,
        nodeKind: startNode.kind,
      },
      requestId: requestId ?? null,
    });
  } catch (err) {
    // Dispatch failure: run stays queued (recoverable via stall sweep / pause→resume)
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId: stepRun.id,
      nodeId: startNode.id,
      eventName: "agent-loop.chain.dispatch_failed",
      status: "failed",
      level: "error",
      summary: "Failed to dispatch start node step workflow",
      payload: {
        stepRunId: stepRun.id,
        nodeId: startNode.id,
        error: err instanceof Error ? err.message : String(err),
      },
      requestId: requestId ?? null,
    });
    // Do NOT fail the run — leave queued so stall sweep can recover.
  }

  return { created: true, runId: loopRunId };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Dispatches a loop run for a matched trigger event (GitHub webhook, cron, etc.).
 * Called by background-agents/dispatcher.ts when a loop-bound trigger matches.
 *
 * Gate order:
 *   1. AGENT_LOOPS_ENABLED flag
 *   2. AGENT_LOOPS_ALLOWED_REPOS allowlist
 *   3. loop.status === "active"
 *   4. validateLoopDefinition (defensive)
 *   5. single-active-run rule (hasActiveRunForLoop)
 *   6. createAgentLoopRun (idempotency)
 *   7. createAgentLoopStepRun + start()
 */
export async function dispatchLoopRunForTrigger(
  params: DispatchLoopRunForTriggerParams,
): Promise<LoopDispatchResult> {
  const { loop, trigger, event, requestId } = params;

  // Gate 1: feature flag
  if (!isAgentLoopsEnabled()) {
    return { skipped: true, reason: "feature_disabled" };
  }

  // Gate 2: repo allowlist
  const repoOwner = event.repoOwner ?? loop.repoOwner;
  const repoName = event.repoName ?? loop.repoName;
  if (!isAgentLoopRepoAllowed(repoOwner, repoName)) {
    return { skipped: true, reason: "repo_not_allowed" };
  }

  // Gate 3: loop must be active
  if (loop.status !== "active") {
    return { skipped: true, reason: "loop_inactive" };
  }

  const idempotencyKey = buildIdempotencyKey({
    loopId: loop.id,
    triggerId: trigger.id,
    source: event.source,
    kind: event.kind,
    externalId: event.externalId,
  });

  return dispatchLoopRun({
    loop,
    trigger,
    event,
    idempotencyKey,
    requestId,
  });
}

/**
 * Starts a loop run manually (M1-08 API route wiring).
 * Uses getOwnedAgentLoop to enforce ownership before dispatching.
 *
 * Returns { skipped: true, reason: "ownership_fail" } for a missing/other-user loop,
 * { skipped: true, reason: "active_run" } when a run is already in progress (409-style signal),
 * or a normal dispatch result.
 */
export async function dispatchManualAgentLoopStart(params: {
  userId: string;
  loopId: string;
  requestId?: string | null;
}): Promise<LoopDispatchResult> {
  const { userId, loopId, requestId } = params;

  // Gate 1: feature flag
  if (!isAgentLoopsEnabled()) {
    return { skipped: true, reason: "feature_disabled" };
  }

  // Ownership check (ownership-scoped load)
  const loop = await getOwnedAgentLoop({ userId, loopId });
  if (!loop) {
    return { skipped: true, reason: "ownership_fail" };
  }

  // Gate 2: repo allowlist
  if (!isAgentLoopRepoAllowed(loop.repoOwner, loop.repoName)) {
    return { skipped: true, reason: "repo_not_allowed" };
  }

  // Gate 3: loop must be active
  if (loop.status !== "active") {
    return { skipped: true, reason: "loop_inactive" };
  }

  // Single-active-run rule (checked before idempotency key to give a clean signal)
  const hasActive = await hasActiveRunForLoop(loop.id);
  if (hasActive) {
    return { skipped: true, reason: "active_run" };
  }

  // Manual idempotency: use requestId as the stable key if provided, otherwise random.
  // This allows the M1-08 route to retry safely within a single request,
  // but does not deduplicate across separate user clicks (intentional for manual start).
  const manualKey = `${loopId}:manual:${requestId ?? crypto.randomUUID()}`;

  // Fake trigger id for observability (manual starts have no trigger row)
  const manualTrigger = {
    id: "manual",
    loopId,
    kind: "schedule.cron" as const, // placeholder kind for event payload
    conditions: {},
    schedule: null,
  };

  const event = {
    source: "manual" as const,
    kind: "manual",
    externalId: manualKey,
    repoOwner: loop.repoOwner,
    repoName: loop.repoName,
    occurredAt: new Date().toISOString(),
  };

  return dispatchLoopRun({
    loop,
    trigger: manualTrigger,
    event,
    idempotencyKey: manualKey,
    requestId,
  });
}
