import "server-only";

import { start } from "workflow/api";
import { runBackgroundAgentWorkflow } from "@/app/workflows/background-agent";
import {
  createRunForTrigger,
  getWebhookTriggerByPublicId,
  listEnabledScheduleTriggers,
  listMatchingTriggersForEvent,
  recordBackgroundAgentEvent,
  type BackgroundAgentWithTriggers,
} from "./store";
import {
  type BackgroundAgentRunSource,
  type NormalizedBackgroundTriggerEvent,
} from "./types";
import { isBackgroundAgentsEnabled } from "./config";
import { scheduleMatchesNow } from "./schedule";

export type BackgroundDispatchResult = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
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
    };
  }

  const matches = await listMatchingTriggersForEvent(params.event);
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];

  for (const match of matches) {
    const result = await createRunForTrigger({
      ...match,
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
      agentId: match.agent.id,
      userId: match.agent.userId,
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
      await recordBackgroundAgentEvent({
        runId: result.run.id,
        agentId: match.agent.id,
        userId: match.agent.userId,
        eventName: "background-agent.workflow.start_failed",
        status: "failed",
        level: "warn",
        summary: "Failed to start background agent workflow.",
        requestId: params.requestId ?? null,
        errorKind: "workflow_failed",
      });
    }
  }

  return {
    enabled: true,
    matched: matches.length,
    created,
    duplicates,
    runIds,
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
    };
  }

  const row = await getWebhookTriggerByPublicId(params.webhookPublicId);
  if (
    !row ||
    row.agent.status !== "enabled" ||
    row.trigger.status !== "enabled"
  ) {
    return {
      enabled: true,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
    };
  }

  const event: NormalizedBackgroundTriggerEvent = {
    ...params.event,
    source: "webhook",
    kind: "webhook.error",
    repoOwner: params.event.repoOwner ?? row.agent.repoOwner,
    repoName: params.event.repoName ?? row.agent.repoName,
  };

  const result = await createRunForTrigger({
    agent: row.agent,
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
    };
  }

  await recordBackgroundAgentEvent({
    runId: result.run.id,
    agentId: row.agent.id,
    userId: row.agent.userId,
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
  await startRun(result.run.id);

  return {
    enabled: true,
    matched: 1,
    created: 1,
    duplicates: 0,
    runIds: [result.run.id],
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
    branch: "manual-test",
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
    await recordBackgroundAgentEvent({
      runId: result.run.id,
      agentId: params.agent.id,
      userId: params.agent.userId,
      eventName: "background-agent.workflow.start_failed",
      status: "failed",
      level: "warn",
      summary: "Failed to start background agent workflow.",
      requestId: params.requestId ?? null,
      errorKind: "workflow_failed",
    });
  }

  return {
    enabled: true,
    matched: 1,
    created: result.created ? 1 : 0,
    duplicates: result.created ? 0 : 1,
    runIds: [result.run.id],
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
    };
  }

  const now = params?.now ?? new Date();
  const rows = (await listEnabledScheduleTriggers()).filter(({ trigger }) =>
    scheduleMatchesNow(trigger.schedule, now),
  );
  let created = 0;
  let duplicates = 0;
  const runIds: string[] = [];

  for (const row of rows) {
    const event: NormalizedBackgroundTriggerEvent = {
      source: "schedule" satisfies BackgroundAgentRunSource,
      kind: "schedule.cron",
      externalId: getScheduleExternalId(row.trigger.id, now),
      repoOwner: row.agent.repoOwner,
      repoName: row.agent.repoName,
      action: "scheduled",
      occurredAt: now.toISOString(),
    };
    const result = await createRunForTrigger({
      agent: row.agent,
      trigger: row.trigger,
      event,
      requestId: params?.requestId ?? null,
    });
    runIds.push(result.run.id);

    if (!result.created) {
      duplicates += 1;
      continue;
    }

    created += 1;
    await startRun(result.run.id);
  }

  return {
    enabled: true,
    matched: rows.length,
    created,
    duplicates,
    runIds,
  };
}
