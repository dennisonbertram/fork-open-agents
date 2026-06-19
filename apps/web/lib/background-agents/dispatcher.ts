import "server-only";

import { start } from "workflow/api";
import { runBackgroundAgentWorkflow } from "@/app/workflows/background-agent";
import {
  advanceTriggerScheduleState,
  createRunForTrigger,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
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
  isBackgroundAgentRepoAllowed,
  isBackgroundAgentsEnabled,
} from "./config";
import { scheduleMatchesNow } from "./schedule";
import { computeNextRuns } from "./schedule-presets";
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
};

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
  if (
    !isBackgroundAgentRepoAllowed(params.event.repoOwner, params.event.repoName)
  ) {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }

  const matches = await listMatchingTriggersForEvent(params.event);
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];
  const loopRunIds: string[] = [];

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
    if (!isBackgroundAgentRepoAllowed(loop.repoOwner, loop.repoName)) {
      return {
        enabled: true,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
        loopRunIds: [],
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
    return {
      enabled: true,
      matched: 1,
      created: loopRunIds.length,
      duplicates: loopResult.skipped ? 0 : loopResult.created === false ? 1 : 0,
      runIds: [],
      loopRunIds,
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
    repoOwner: params.event.repoOwner ?? agent.repoOwner,
    repoName: params.event.repoName ?? agent.repoName,
  };
  if (!isBackgroundAgentRepoAllowed(event.repoOwner, event.repoName)) {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
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

  const trigger =
    params.agent.triggers.find((item) => item.status === "enabled") ??
    params.agent.triggers[0];
  if (!trigger) {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
    };
  }
  if (
    !isBackgroundAgentRepoAllowed(params.agent.repoOwner, params.agent.repoName)
  ) {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
      loopRunIds: [],
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

function getScheduleExternalId(triggerId: string, now: Date): string {
  const minuteBucket = now.toISOString().slice(0, 16);
  return `${triggerId}:${minuteBucket}`;
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
  const allRows = await listEnabledScheduleTriggers();
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];
  const loopRunIds: string[] = [];
  const matchedRows: typeof allRows = [];

  // Separate rows into matched (will dispatch) and skipped (record skip reason).
  // Loop-bound rows skip the background-agents allowlist — they use
  // isAgentLoopRepoAllowed inside dispatchLoopRunForTrigger (different env var).
  // Agent-bound rows use isBackgroundAgentRepoAllowed as before.
  for (const row of allRows) {
    // Branch on loopId BEFORE accessing row.agent (null for loop triggers).
    if (!row.trigger.loopId) {
      // Agent-bound: guard non-null agent then check allowlist.
      const agent = row.agent;
      if (!agent) {
        // Defensive: row has neither loopId nor agent — skip.
        continue;
      }
      const repoAllowed = isBackgroundAgentRepoAllowed(
        agent.repoOwner,
        agent.repoName,
      );
      if (!repoAllowed) {
        await recordTriggerSkipReason({
          triggerId: row.trigger.id,
          skipReason: "repo not in allowlist",
        });
        continue;
      }
    }
    // Loop-bound rows: allowlist check deferred to dispatchLoopRunForTrigger.

    const scheduleMatches = scheduleMatchesNow(row.trigger.schedule, now);
    if (!scheduleMatches) {
      await recordTriggerSkipReason({
        triggerId: row.trigger.id,
        skipReason: "schedule did not match current time",
      });
      continue;
    }

    matchedRows.push(row);
  }

  for (const row of matchedRows) {
    // ── Loop-bound schedule trigger (M1-07) ────────────────────────────────
    if (row.trigger.loopId) {
      // Advance schedule state unconditionally (same wedge-prevention semantics
      // as agent triggers — loop runs must not wedge the cron schedule).
      const nextRuns = computeNextRuns(row.trigger.schedule, now, 1);
      await advanceTriggerScheduleState({
        triggerId: row.trigger.id,
        lastRunAt: now,
        nextRunAt: nextRuns[0] ?? null,
      });
      const loop = await getAgentLoopById(row.trigger.loopId);
      if (!loop) continue;

      const event = {
        source: "schedule" as const,
        kind: "schedule.cron",
        externalId: getScheduleExternalId(row.trigger.id, now),
        repoOwner: loop.repoOwner,
        repoName: loop.repoName,
        action: "scheduled",
        occurredAt: now.toISOString(),
      };

      const loopResult = await dispatchLoopRunForTrigger({
        loop,
        trigger: row.trigger,
        event,
        requestId: params?.requestId ?? null,
      });

      if (!loopResult.skipped && loopResult.runId) {
        loopRunIds.push(loopResult.runId);
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
    const event: NormalizedBackgroundTriggerEvent = {
      source: "schedule" satisfies BackgroundAgentRunSource,
      kind: "schedule.cron",
      externalId: getScheduleExternalId(row.trigger.id, now),
      repoOwner: agent.repoOwner,
      repoName: agent.repoName,
      action: "scheduled",
      occurredAt: now.toISOString(),
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
    const nextRuns = computeNextRuns(row.trigger.schedule, now, 1);
    await advanceTriggerScheduleState({
      triggerId: row.trigger.id,
      lastRunAt: now,
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
  };
}
