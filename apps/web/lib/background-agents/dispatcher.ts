import "server-only";

import { start } from "workflow/api";
import { runBackgroundAgentWorkflow } from "@/app/workflows/background-agent";
import {
  advanceTriggerScheduleState,
  countRecentRunsForTarget,
  createRunForTrigger,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
  listStaleBackgroundAgentRuns,
  seedTriggerNextRunAt,
  listMatchingTriggersForEvent,
  recordBackgroundAgentEvent,
  recordTriggerSkipReason,
  updateBackgroundAgentRunStatus,
  type BackgroundAgentWithTriggers,
} from "./store";
import {
  type BackgroundAgentRunSource,
  type NormalizedBackgroundTriggerEvent,
} from "./types";
import {
  getBackgroundAgentRepoAccess,
  isBackgroundAgentsEnabled,
  type BackgroundAgentRepoRefusalReason,
} from "./config";
import { scheduleMatchesNow } from "./schedule";
import { computeNextRuns, validateSchedule } from "./schedule-presets";
import { getAgentLoopById } from "@/lib/agent-loops/store";
import { dispatchLoopRunForTrigger } from "@/lib/agent-loops/dispatcher-bridge";
// Note: dispatchLoopRunForTrigger is dynamically imported within the
// functions that use it (see below) to prevent the agent-loops module tree
// from being loaded when dispatcher.ts is imported in test contexts that
// only need the agent-bound trigger paths.

export type BackgroundDispatchResult = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  /** Run ids for loop runs dispatched in this invocation (M1-07). */
  loopRunIds: string[];
  /**
   * Set when nothing ran because the request was refused before matching —
   * e.g. a manual test against a disabled agent (#743) or a manual test
   * against a repo outside the allowlist (#861). Callers (the test API
   * route) surface this so the operator sees WHY nothing ran.
   */
  skipReason?:
    | "agent_disabled"
    | "no_enabled_trigger"
    | BackgroundAgentRepoRefusalReason;
  /**
   * Triggers the scheduled sweep refused, and why. Present only when at least
   * one was refused, so a clean sweep stays byte-identical to before.
   *
   * The sweep already writes `last_skip_reason` to each trigger row, but the
   * cron response reported nothing: a refused trigger and an idle one both
   * answered `{"matched":0,...}`. One production trigger was refused weekly
   * from 2026-07-06 for six weeks without surfacing anywhere an operator
   * looks.
   */
  skipped?: Array<{ triggerId: string; reason: string }>;
};

function policyStateForReason(reason: BackgroundAgentRepoRefusalReason) {
  if (reason === "repo_allowlist_unconfigured") {
    return "missing" as const;
  }
  if (reason === "repo_allowlist_invalid") {
    return "invalid" as const;
  }
  return "list" as const;
}

function warnBackgroundAgentRepoPolicyRefused(params: {
  repoOwner: string;
  repoName: string;
  reason: BackgroundAgentRepoRefusalReason;
  requestId?: string | null;
  deliveryId?: string | null;
  triggerId?: string | null;
}) {
  const log =
    params.reason === "repo_not_allowlisted" ? console.info : console.warn;
  log("[background-agents] repository policy refused dispatch", {
    eventName: "background-agent.dispatch.repo-policy-refused",
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    policyState: policyStateForReason(params.reason),
    reason: params.reason,
    requestId: params.requestId ?? null,
    deliveryId: params.deliveryId ?? null,
    triggerId: params.triggerId ?? null,
  });
}

function mapLoopRepoPolicySkipReason(
  reason: string | undefined,
): BackgroundAgentRepoRefusalReason | null {
  if (
    reason === "repo_allowlist_unconfigured" ||
    reason === "repo_allowlist_invalid"
  ) {
    return reason;
  }
  return reason === "repo_not_allowed" ? "repo_not_allowlisted" : null;
}

type WorkflowStartFailureInput = {
  runId: string;
  agentId: string;
  userId: string;
  requestId?: string | null;
};

async function startRun(runId: string): Promise<string | null> {
  try {
    const run = await start(runBackgroundAgentWorkflow, [{ runId }]);
    return run.runId;
  } catch (error) {
    console.error("[background-agents] Failed to start workflow:", error);
    return null;
  }
}

const RUN_BUDGET_WINDOW_HOURS = 24;

/**
 * #749 loop-safety backstop: refuses to create another run for this agent
 * against the same (repo, prNumber) once the agent's runBudgetPerTarget is
 * reached within a rolling 24h window. Prevents unbounded
 * implementer -> reviewer -> fixer ping-pong.
 *
 * There is no runId yet at this point (no run is created), so this cannot
 * use recordBackgroundAgentEvent (which requires a runId). Instead the skip
 * is surfaced via recordTriggerSkipReason (visible in the trigger's UI card)
 * plus a structured console.warn — a deliberate deviation from the
 * runId-scoped event surface (documented in the PR).
 */
async function isRunBudgetExhausted(params: {
  agent: { id: string; repoOwner: string; repoName: string };
  trigger: { id: string };
  event: NormalizedBackgroundTriggerEvent;
  runBudgetPerTarget: number;
  requestId?: string | null;
}): Promise<boolean> {
  if (params.event.prNumber == null) {
    return false;
  }

  const since = new Date(Date.now() - RUN_BUDGET_WINDOW_HOURS * 60 * 60 * 1000);
  const recentRuns = await countRecentRunsForTarget({
    agentId: params.agent.id,
    repoOwner: params.agent.repoOwner,
    repoName: params.agent.repoName,
    prNumber: params.event.prNumber,
    since,
  });

  if (recentRuns < params.runBudgetPerTarget) {
    return false;
  }

  await recordTriggerSkipReason({
    triggerId: params.trigger.id,
    skipReason: `budget exhausted: ${recentRuns}/${params.runBudgetPerTarget} runs in ${RUN_BUDGET_WINDOW_HOURS}h for PR #${params.event.prNumber}`,
  });
  console.warn("[background-agents] run budget exhausted", {
    eventName: "background-agent.run.budget_exhausted",
    agentId: params.agent.id,
    repoOwner: params.agent.repoOwner,
    repoName: params.agent.repoName,
    prNumber: params.event.prNumber,
    budget: params.runBudgetPerTarget,
    windowHours: RUN_BUDGET_WINDOW_HOURS,
    requestId: params.requestId ?? null,
  });
  return true;
}

async function recordWorkflowStartFailure(input: WorkflowStartFailureInput) {
  await updateBackgroundAgentRunStatus({
    runId: input.runId,
    status: "failed",
    workflowRunId: null,
    errorKind: "workflow_failed",
    errorMessage: "Failed to start background agent workflow.",
  });
  await recordBackgroundAgentEvent({
    runId: input.runId,
    agentId: input.agentId,
    userId: input.userId,
    eventName: "background-agent.workflow.start_failed",
    status: "failed",
    level: "warn",
    summary: "Failed to start background agent workflow.",
    requestId: input.requestId ?? null,
    errorKind: "workflow_failed",
  });
}

export async function dispatchBackgroundTriggerEvent(params: {
  event: NormalizedBackgroundTriggerEvent;
  requestId?: string | null;
}): Promise<BackgroundDispatchResult> {
  if (!isBackgroundAgentsEnabled()) {
    return {
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }
  const repoAccess = getBackgroundAgentRepoAccess(
    params.event.repoOwner,
    params.event.repoName,
  );
  if (!repoAccess.allowed) {
    warnBackgroundAgentRepoPolicyRefused({
      repoOwner: params.event.repoOwner,
      repoName: params.event.repoName,
      reason: repoAccess.reason,
      requestId: params.requestId,
      deliveryId: params.event.externalId,
    });
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: repoAccess.reason,
    };
  }

  const matches = await listMatchingTriggersForEvent(params.event);
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];
  const loopRunIds: string[] = [];
  let loopPolicySkipReason: BackgroundAgentRepoRefusalReason | undefined;

  for (const match of matches) {
    // ── Loop-bound trigger branch (M1-07) ────────────────────────────────────
    if (match.trigger.loopId) {
      const loop = await getAgentLoopById(match.trigger.loopId);
      if (!loop) {
        // Orphaned trigger row — skip silently (should not happen due to FK)
        continue;
      }
      const loopResult = await dispatchLoopRunForTrigger({
        loop,
        trigger: match.trigger,
        event: params.event,
        requestId: params.requestId,
      });
      if (!loopResult.skipped && loopResult.runId) {
        loopRunIds.push(loopResult.runId);
      } else if (loopResult.skipped) {
        const reason = mapLoopRepoPolicySkipReason(loopResult.reason);
        if (reason) {
          loopPolicySkipReason ??= reason;
          await recordTriggerSkipReason({
            triggerId: match.trigger.id,
            skipReason: reason,
          });
        }
      }
      continue;
    }

    // ── Agent-bound trigger branch (unchanged) ────────────────────────────────
    // Agent is guaranteed non-null here: loop-bound rows took the branch above.
    const agent = match.agent;
    if (!agent) {
      // Defensive guard: should not happen — row has neither loopId nor agent.
      continue;
    }

    // #749: per-agent-per-PR run budget backstop — checked before creating a
    // run so an exhausted budget never wedges the run/idempotency tables.
    const budgetExhausted = await isRunBudgetExhausted({
      agent,
      trigger: match.trigger,
      event: params.event,
      runBudgetPerTarget: agent.runBudgetPerTarget,
      requestId: params.requestId,
    });
    if (budgetExhausted) {
      continue;
    }

    const result = await createRunForTrigger({
      agent,
      trigger: match.trigger,
      event: params.event,
      requestId: params.requestId,
    });
    runIds.push(result.run.id);

    if (!result.created) {
      duplicates += 1;
      continue;
    }

    created += 1;
    await recordBackgroundAgentEvent({
      runId: result.run.id,
      agentId: agent.id,
      userId: agent.userId,
      eventName: "background-agent.trigger.received",
      status: "info",
      summary: `Received ${params.event.kind} trigger.`,
      requestId: params.requestId ?? null,
      payload: {
        source: params.event.source,
        triggerKind: params.event.kind,
        externalId: params.event.externalId,
      },
    });
    const workflowRunId = await startRun(result.run.id);
    if (!workflowRunId) {
      await recordWorkflowStartFailure({
        runId: result.run.id,
        agentId: agent.id,
        userId: agent.userId,
        requestId: params.requestId ?? null,
      });
    }
  }

  return {
    enabled: true,
    matched: matches.length,
    created,
    duplicates,
    runIds,
    loopRunIds,
    ...(created === 0 && duplicates === 0 && loopPolicySkipReason
      ? { skipReason: loopPolicySkipReason }
      : {}),
  };
}

export async function dispatchWebhookErrorEvent(params: {
  webhookPublicId: string;
  event: Omit<
    NormalizedBackgroundTriggerEvent,
    "source" | "kind" | "repoOwner" | "repoName"
  > & {
    repoOwner?: string;
    repoName?: string;
  };
  requestId?: string | null;
}): Promise<BackgroundDispatchResult> {
  if (!isBackgroundAgentsEnabled()) {
    return {
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  const row = await getWebhookTriggerByPublicId(params.webhookPublicId);
  if (!row || row.trigger.status !== "enabled") {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  // ── Loop-bound webhook.error trigger branch ───────────────────────────────
  // Check loopId BEFORE dereferencing row.agent (which is null for loop triggers).
  // The loop path also passes through the background-agents allowlist for
  // consistency with the agent-bound path.  The loop's own allowlist
  // (isAgentLoopRepoAllowed inside dispatchLoopRunForTrigger) gates different
  // env vars; double-gating is intentional for shared-trigger surfaces like
  // webhooks so neither path provides a bypass.
  if (row.trigger.loopId) {
    const loop = await getAgentLoopById(row.trigger.loopId);
    if (!loop) {
      // Orphaned trigger row — skip silently (should not happen due to FK)
      return {
        enabled: true,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
        loopRunIds: [],
      };
    }

    // Gate the loop-bound path against the background-agents allowlist too.
    // Without this check, an external caller could post a webhook to a
    // loop-bound trigger whose repo is allowed by AGENT_LOOPS_ALLOWED_REPOS
    // but not by BACKGROUND_AGENTS_ALLOWED_REPOS — the agent-bound path would
    // be blocked (line 295) but the loop path would slip through.
    const loopRepoAccess = getBackgroundAgentRepoAccess(
      loop.repoOwner,
      loop.repoName,
    );
    if (!loopRepoAccess.allowed) {
      await recordTriggerSkipReason({
        triggerId: row.trigger.id,
        skipReason: loopRepoAccess.reason,
      });
      warnBackgroundAgentRepoPolicyRefused({
        repoOwner: loop.repoOwner,
        repoName: loop.repoName,
        reason: loopRepoAccess.reason,
        requestId: params.requestId,
        deliveryId: params.event.externalId,
        triggerId: row.trigger.id,
      });
      return {
        enabled: true,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
        loopRunIds: [],
        skipReason: loopRepoAccess.reason,
      };
    }

    const loopEvent: NormalizedBackgroundTriggerEvent = {
      ...params.event,
      source: "webhook",
      kind: "webhook.error",
      // Pin repo to the loop unconditionally — never let the caller-supplied
      // webhook payload override the loop's repo.  Using payload values here
      // would allow an external caller to (a) cause a false-skip when a
      // different-repo payload is posted and the loop's actual repo IS in the
      // allowlist, or (b) bypass the allowlist gate by posting an allowlisted
      // repo for a loop whose real repo is NOT in AGENT_LOOPS_ALLOWED_REPOS.
      repoOwner: loop.repoOwner,
      repoName: loop.repoName,
    };
    const loopResult = await dispatchLoopRunForTrigger({
      loop,
      trigger: row.trigger,
      event: loopEvent,
      requestId: params.requestId,
    });
    const loopRunIds: string[] = [];
    if (!loopResult.skipped && loopResult.runId) {
      loopRunIds.push(loopResult.runId);
    }
    const loopPolicySkipReason = loopResult.skipped
      ? mapLoopRepoPolicySkipReason(loopResult.reason)
      : null;
    if (loopPolicySkipReason) {
      await recordTriggerSkipReason({
        triggerId: row.trigger.id,
        skipReason: loopPolicySkipReason,
      });
    }
    return {
      enabled: true,
      matched: 1,
      created: loopRunIds.length,
      duplicates: loopResult.skipped ? 0 : loopResult.created === false ? 1 : 0,
      runIds: [],
      loopRunIds,
      ...(loopPolicySkipReason ? { skipReason: loopPolicySkipReason } : {}),
    };
  }

  // ── Agent-bound webhook.error trigger branch (unchanged) ──────────────────
  // Agent is guaranteed non-null here: loop-bound rows took the branch above.
  const agent = row.agent;
  if (!agent || agent.status !== "enabled") {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  const event: NormalizedBackgroundTriggerEvent = {
    ...params.event,
    source: "webhook",
    kind: "webhook.error",
    repoOwner: agent.repoOwner,
    repoName: agent.repoName,
  };
  const repoAccess = getBackgroundAgentRepoAccess(
    event.repoOwner,
    event.repoName,
  );
  if (!repoAccess.allowed) {
    await recordTriggerSkipReason({
      triggerId: row.trigger.id,
      skipReason: repoAccess.reason,
    });
    warnBackgroundAgentRepoPolicyRefused({
      repoOwner: event.repoOwner,
      repoName: event.repoName,
      reason: repoAccess.reason,
      requestId: params.requestId,
      deliveryId: params.event.externalId,
      triggerId: row.trigger.id,
    });
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: repoAccess.reason,
    };
  }

  const result = await createRunForTrigger({
    agent,
    trigger: row.trigger,
    event,
    requestId: params.requestId,
  });

  if (!result.created) {
    return {
      enabled: true,
      matched: 1,
      created: 0,
      duplicates: 1,
      runIds: [result.run.id],
      loopRunIds: [],
    };
  }

  await recordBackgroundAgentEvent({
    runId: result.run.id,
    agentId: agent.id,
    userId: agent.userId,
    eventName: "background-agent.trigger.received",
    status: "info",
    summary: "Received webhook error trigger.",
    requestId: params.requestId ?? null,
    payload: {
      source: event.source,
      triggerKind: event.kind,
      externalId: event.externalId,
    },
  });
  const workflowRunId = await startRun(result.run.id);
  if (!workflowRunId) {
    await recordWorkflowStartFailure({
      runId: result.run.id,
      agentId: agent.id,
      userId: agent.userId,
      requestId: params.requestId ?? null,
    });
  }

  return {
    enabled: true,
    matched: 1,
    created: 1,
    duplicates: 0,
    runIds: [result.run.id],
    loopRunIds: [],
  };
}

/**
 * #861: the skip happens before any run row exists, so there's no runId to
 * attach a persisted event to yet — mirrors the isRunBudgetExhausted
 * runId-less constraint documented above. A structured console.warn keeps
 * this operator-grep-able instead of silent.
 */
function warnManualTestSkipped(
  params: {
    agent: BackgroundAgentWithTriggers;
    requestId?: string | null;
  },
  skipReason: NonNullable<BackgroundDispatchResult["skipReason"]>,
) {
  console.warn("[background-agents] manual test skipped", {
    eventName: "background-agent.manual_test.skipped",
    agentId: params.agent.id,
    userId: params.agent.userId,
    skipReason,
    requestId: params.requestId ?? null,
  });
}

export async function dispatchManualBackgroundAgentTest(params: {
  agent: BackgroundAgentWithTriggers;
  requestId?: string | null;
}): Promise<BackgroundDispatchResult> {
  if (!isBackgroundAgentsEnabled()) {
    return {
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  // #743: a disabled agent must never run, even via the manual Test button —
  // it can trigger real GitHub/PR mutations if it slips through.
  if (params.agent.status !== "enabled") {
    warnManualTestSkipped(params, "agent_disabled");
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "agent_disabled",
    };
  }

  // Only an enabled trigger counts — never fall back to a disabled trigger
  // just because it's the only one configured on the agent.
  const trigger = params.agent.triggers.find(
    (item) => item.status === "enabled",
  );
  if (!trigger) {
    warnManualTestSkipped(params, "no_enabled_trigger");
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: "no_enabled_trigger",
    };
  }
  const repoAccess = getBackgroundAgentRepoAccess(
    params.agent.repoOwner,
    params.agent.repoName,
  );
  if (!repoAccess.allowed) {
    warnBackgroundAgentRepoPolicyRefused({
      repoOwner: params.agent.repoOwner,
      repoName: params.agent.repoName,
      reason: repoAccess.reason,
      requestId: params.requestId,
      triggerId: trigger.id,
    });
    warnManualTestSkipped(params, repoAccess.reason);
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
      skipReason: repoAccess.reason,
    };
  }

  const now = new Date();
  const event: NormalizedBackgroundTriggerEvent = {
    source:
      trigger.kind === "schedule.cron"
        ? "schedule"
        : trigger.kind === "webhook.error"
          ? "webhook"
          : "github",
    kind: trigger.kind,
    externalId: `manual-test:${params.agent.id}:${crypto.randomUUID()}`,
    repoOwner: params.agent.repoOwner,
    repoName: params.agent.repoName,
    action: "manual_test",
    title: `Manual test for ${params.agent.name}`,
    message: "Manual background-agent test trigger.",
    occurredAt: now.toISOString(),
  };

  const result = await createRunForTrigger({
    agent: params.agent,
    trigger,
    event,
    requestId: params.requestId ?? null,
  });

  await recordBackgroundAgentEvent({
    runId: result.run.id,
    agentId: params.agent.id,
    userId: params.agent.userId,
    eventName: "background-agent.trigger.received",
    status: "info",
    summary: "Received manual background-agent test trigger.",
    requestId: params.requestId ?? null,
    payload: {
      source: event.source,
      triggerKind: event.kind,
      externalId: event.externalId,
      manual: true,
    },
  });

  const workflowRunId = await startRun(result.run.id);
  if (!workflowRunId) {
    await recordWorkflowStartFailure({
      runId: result.run.id,
      agentId: params.agent.id,
      userId: params.agent.userId,
      requestId: params.requestId ?? null,
    });
  }

  return {
    enabled: true,
    matched: 1,
    created: result.created ? 1 : 0,
    duplicates: result.created ? 0 : 1,
    runIds: [result.run.id],
    loopRunIds: [],
  };
}

function getScheduleExternalId(triggerId: string, dueAt: Date): string {
  const minuteBucket = dueAt.toISOString().slice(0, 16);
  return `${triggerId}:${minuteBucket}`;
}

function getDueScheduleTime(
  trigger: { nextRunAt?: Date | null },
  now: Date,
): Date {
  return trigger.nextRunAt && trigger.nextRunAt <= now
    ? trigger.nextRunAt
    : now;
}

async function sweepStaleBackgroundRuns(params: {
  now: Date;
  requestId?: string | null;
}) {
  const staleAfterMs = Number(
    process.env.BACKGROUND_AGENTS_STALE_RUN_MS ?? 2 * 60 * 60 * 1000,
  );
  const staleBefore = new Date(params.now.getTime() - staleAfterMs);
  const staleRuns = await listStaleBackgroundAgentRuns({
    staleBefore,
    limit: 50,
  });

  for (const run of staleRuns) {
    // #743: force:true — a stale/stuck run may have already reached a
    // terminal status via a race with its own executor. The sweeper's job is
    // to terminalize genuinely stuck runs, so it must bypass the
    // terminal-status guard rather than have its own update silently refused.
    await updateBackgroundAgentRunStatus({
      runId: run.id,
      status: "failed",
      errorKind: "stuck_running",
      errorMessage:
        "Background agent run exceeded the stale threshold and was swept by cron.",
      force: true,
      agentId: run.agentId,
      userId: run.userId,
    });
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      eventName: "background-agent.run.swept_stale",
      status: "failed",
      level: "warn",
      summary:
        "Background agent run was terminalized by the stale-run sweeper.",
      requestId: params.requestId ?? null,
      workflowRunId: run.workflowRunId,
      sandboxName: run.sandboxName,
      errorKind: "stuck_running",
      payload: {
        staleAfterMs,
        lastEventAt: run.updatedAt.toISOString(),
      },
    });
  }
}

export async function dispatchScheduledBackgroundAgents(params?: {
  now?: Date;
  requestId?: string | null;
}): Promise<BackgroundDispatchResult> {
  if (!isBackgroundAgentsEnabled()) {
    return {
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  const now = params?.now ?? new Date();
  await sweepStaleBackgroundRuns({
    now,
    requestId: params?.requestId ?? null,
  });
  const allRows = await listEnabledScheduleTriggers();
  // Mirrors every recordTriggerSkipReason call the sweep makes, so the cron
  // response tells an operator what was refused instead of only what ran.
  const skipped: Array<{ triggerId: string; reason: string }> = [];
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];
  const loopRunIds: string[] = [];
  const matchedRows: typeof allRows = [];

  // Separate rows into matched (will dispatch) and skipped (record skip reason).
  // Schedule validity/due state is evaluated before repository policy. A
  // future schedule is expected idle state and must not persist or log a
  // policy refusal on every cron sweep. Loop-bound rows skip the
  // background-agents allowlist and use the loop allowlist in the bridge.
  for (const row of allRows) {
    // An invalid schedule expression is an actionable misconfiguration —
    // record a skip reason so the user sees it in the schedule card.
    // An ordinary "not due yet" result is expected on nearly every sweep
    // (the cron tick runs every 5 minutes) and must NOT record a skip
    // reason, or the schedule card would show a permanent amber warning.
    if (!validateSchedule(row.trigger.schedule).valid) {
      await recordTriggerSkipReason({
        triggerId: row.trigger.id,
        skipReason: "invalid schedule expression",
      });
      skipped.push({
        triggerId: row.trigger.id,
        reason: "invalid schedule expression",
      });
      continue;
    }

    // Legacy rows created before #750 have nextRunAt null and would only
    // ever fire on an exact-minute coincidence with the */5 platform tick —
    // off-grid schedules (e.g. '7 * * * *') would never fire at all. Seed
    // the persisted nextRunAt once so the due-window path below reaches
    // them on the first sweep after their next matching minute.
    const persistedNextRunAt = row.trigger.nextRunAt;
    if (persistedNextRunAt == null) {
      const seeded = computeNextRuns(row.trigger.schedule, now, 1)[0] ?? null;
      await seedTriggerNextRunAt({
        triggerId: row.trigger.id,
        nextRunAt: seeded,
      });
    }

    const scheduleMatches = persistedNextRunAt
      ? persistedNextRunAt <= now
      : scheduleMatchesNow(row.trigger.schedule, now);
    if (!scheduleMatches) {
      continue;
    }

    // Branch on loopId BEFORE accessing row.agent (null for loop triggers).
    if (!row.trigger.loopId) {
      const agent = row.agent;
      if (!agent) {
        // Defensive: row has neither loopId nor agent — skip.
        continue;
      }
      const repoAccess = getBackgroundAgentRepoAccess(
        agent.repoOwner,
        agent.repoName,
      );
      if (!repoAccess.allowed) {
        await recordTriggerSkipReason({
          triggerId: row.trigger.id,
          skipReason: repoAccess.reason,
        });
        skipped.push({
          triggerId: row.trigger.id,
          reason: repoAccess.reason,
        });
        warnBackgroundAgentRepoPolicyRefused({
          repoOwner: agent.repoOwner,
          repoName: agent.repoName,
          reason: repoAccess.reason,
          requestId: params?.requestId,
          triggerId: row.trigger.id,
        });
        continue;
      }
    }

    matchedRows.push(row);
  }

  for (const row of matchedRows) {
    // ── Loop-bound schedule trigger (M1-07) ────────────────────────────────
    if (row.trigger.loopId) {
      // Advance schedule state unconditionally (same wedge-prevention semantics
      // as agent triggers — loop runs must not wedge the cron schedule).
      const dueAt = getDueScheduleTime(row.trigger, now);
      const nextRuns = computeNextRuns(row.trigger.schedule, dueAt, 1);
      await advanceTriggerScheduleState({
        triggerId: row.trigger.id,
        lastRunAt: dueAt,
        nextRunAt: nextRuns[0] ?? null,
      });
      const loop = await getAgentLoopById(row.trigger.loopId);
      if (!loop) continue;

      const event = {
        source: "schedule" as const,
        kind: "schedule.cron",
        externalId: getScheduleExternalId(row.trigger.id, dueAt),
        repoOwner: loop.repoOwner,
        repoName: loop.repoName,
        action: "scheduled",
        occurredAt: dueAt.toISOString(),
      };

      const loopResult = await dispatchLoopRunForTrigger({
        loop,
        trigger: row.trigger,
        event,
        requestId: params?.requestId ?? null,
      });

      if (!loopResult.skipped && loopResult.runId) {
        loopRunIds.push(loopResult.runId);
      } else if (loopResult.skipped) {
        const reason = mapLoopRepoPolicySkipReason(loopResult.reason);
        if (reason) {
          await recordTriggerSkipReason({
            triggerId: row.trigger.id,
            skipReason: reason,
          });
          skipped.push({ triggerId: row.trigger.id, reason });
        }
      }
      continue;
    }

    // ── Agent-bound schedule trigger (unchanged) ──────────────────────────
    // Agent is guaranteed non-null here: loop-bound rows took the branch above.
    const agent = row.agent;
    if (!agent) {
      // Defensive guard: should not happen — row has neither loopId nor agent.
      continue;
    }
    const dueAt = getDueScheduleTime(row.trigger, now);
    const event: NormalizedBackgroundTriggerEvent = {
      source: "schedule" satisfies BackgroundAgentRunSource,
      kind: "schedule.cron",
      externalId: getScheduleExternalId(row.trigger.id, dueAt),
      repoOwner: agent.repoOwner,
      repoName: agent.repoName,
      action: "scheduled",
      occurredAt: dueAt.toISOString(),
    };
    const result = await createRunForTrigger({
      agent,
      trigger: row.trigger,
      event,
      requestId: params?.requestId ?? null,
    });
    runIds.push(result.run.id);

    // Advance schedule state regardless of whether this was a duplicate.
    // BT-006: a failed run must not wedge the schedule — advance unconditionally.
    const nextRuns = computeNextRuns(row.trigger.schedule, dueAt, 1);
    await advanceTriggerScheduleState({
      triggerId: row.trigger.id,
      lastRunAt: dueAt,
      nextRunAt: nextRuns[0] ?? null,
    });

    if (!result.created) {
      duplicates += 1;
      continue;
    }

    created += 1;
    await recordBackgroundAgentEvent({
      runId: result.run.id,
      agentId: agent.id,
      userId: agent.userId,
      eventName: "background-agent.trigger.received",
      status: "info",
      summary: "Received schedule.cron trigger.",
      requestId: params?.requestId ?? null,
      payload: {
        source: event.source,
        triggerKind: event.kind,
        externalId: event.externalId,
      },
    });
    const workflowRunId = await startRun(result.run.id);
    if (!workflowRunId) {
      await recordWorkflowStartFailure({
        runId: result.run.id,
        agentId: agent.id,
        userId: agent.userId,
        requestId: params?.requestId ?? null,
      });
    }
  }

  return {
    enabled: true,
    matched: matchedRows.length,
    created,
    duplicates,
    runIds,
    loopRunIds,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}
