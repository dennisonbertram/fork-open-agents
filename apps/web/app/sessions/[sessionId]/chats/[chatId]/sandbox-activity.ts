"use client";

import type {
  SessionEventJson,
  SessionObservabilityResponse,
} from "./hooks/use-session-observability";
import type { LifecycleTimingInfo } from "./session-chat-context";

export type SandboxActivityStatusTone =
  | "active"
  | "busy"
  | "paused"
  | "warning"
  | "offline";

export type SandboxActivitySummary = {
  label: string;
  tone: SandboxActivityStatusTone;
  description: string;
  currentActivity: string;
  sandboxName: string;
  lastActivityAtMs: number | null;
  hibernateAfterMs: number | null;
  sandboxExpiresAtMs: number | null;
  lifecycleState: string | null;
  stats: {
    events: number;
    runningEvents: number;
    failedEvents: number;
    workflows: number;
    workers: number;
    runningWorkers: number;
    services: number;
    activeServices: number;
    browserRuns: number;
    toolUses: number;
  };
  recentEvents: SessionEventJson[];
};

type BuildSandboxActivitySummaryParams = {
  hasSandboxState: boolean;
  hasSnapshot: boolean;
  isSandboxActive: boolean;
  uiStatusLabel: string;
  lifecycleTiming: LifecycleTimingInfo;
  observabilityData?: SessionObservabilityResponse | null;
};

const sandboxEventSources = new Set([
  "sandbox",
  "service",
  "browser",
  "managed_runtime",
  "workflow",
]);

const activeStatuses = new Set(["started", "running"]);
const failedStatuses = new Set(["failed", "blocked"]);
const activeServiceStatuses = new Set(["starting", "running", "ready"]);

function eventSummary(event: SessionEventJson): string {
  return event.summary ?? event.eventName;
}

function isSandboxEvent(event: SessionEventJson): boolean {
  if (sandboxEventSources.has(event.source)) {
    return true;
  }

  return Boolean(
    event.sandboxName ||
    event.serviceId ||
    event.browserRunId ||
    event.managedRuntimeProfileRunId,
  );
}

function newestEventTime(events: SessionEventJson[]): number | null {
  for (const event of events) {
    const value = Date.parse(event.createdAt);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function resolveSandboxName(
  data: SessionObservabilityResponse | null | undefined,
  events: SessionEventJson[],
): string {
  const workerName = data?.workers.find(
    (worker) => worker.sandboxName,
  )?.sandboxName;
  if (workerName) {
    return workerName;
  }

  const workflowName = data?.workflowRuns.find(
    (workflow) => workflow.sandboxName,
  )?.sandboxName;
  if (workflowName) {
    return workflowName;
  }

  const profileName = data?.profileRuns.find(
    (profile) => profile.sandboxName,
  )?.sandboxName;
  if (profileName) {
    return profileName;
  }

  const eventName = events.find((event) => event.sandboxName)?.sandboxName;
  return eventName ?? "Session sandbox";
}

function resolveCurrentActivity(params: {
  data: SessionObservabilityResponse | null | undefined;
  events: SessionEventJson[];
  isSandboxActive: boolean;
  hasSnapshot: boolean;
}): string {
  const runningWorker = params.data?.workers.find((worker) =>
    activeStatuses.has(worker.status),
  );
  if (runningWorker?.currentToolSummary) {
    return runningWorker.currentToolSummary;
  }
  if (runningWorker?.currentToolName) {
    return `Using ${runningWorker.currentToolName}`;
  }

  const runningEvent = params.events.find((event) =>
    activeStatuses.has(event.status),
  );
  if (runningEvent) {
    return eventSummary(runningEvent);
  }

  const runningBrowser = params.data?.browserRuns.find((run) =>
    activeStatuses.has(run.status),
  );
  if (runningBrowser) {
    return runningBrowser.summary ?? `Checking ${runningBrowser.targetUrl}`;
  }

  const activeService = params.data?.services.find((service) =>
    activeServiceStatuses.has(service.status),
  );
  if (activeService) {
    return `Service ${activeService.status} on port ${activeService.port}`;
  }

  const latestWorkflow = params.data?.workflowRuns[0];
  if (latestWorkflow && activeStatuses.has(latestWorkflow.status)) {
    return `Workflow ${latestWorkflow.status}`;
  }

  const latestEvent = params.events[0];
  if (latestEvent) {
    return eventSummary(latestEvent);
  }

  if (params.isSandboxActive) {
    return "Sandbox is connected with no recent recorded work.";
  }

  if (params.hasSnapshot) {
    return "Sandbox is paused with a saved snapshot.";
  }

  return "No sandbox is attached to this session.";
}

function resolveTone(params: {
  hasSandboxState: boolean;
  hasSnapshot: boolean;
  isSandboxActive: boolean;
  lifecycleState: string | null;
  failedEvents: number;
  runningSignals: number;
}): SandboxActivityStatusTone {
  if (!params.hasSandboxState && !params.hasSnapshot) {
    return "offline";
  }
  if (params.failedEvents > 0 || params.lifecycleState === "failed") {
    return "warning";
  }
  if (params.runningSignals > 0 || params.lifecycleState === "provisioning") {
    return "busy";
  }
  if (params.isSandboxActive) {
    return "active";
  }
  return "paused";
}

export function buildSandboxActivitySummary({
  hasSandboxState,
  hasSnapshot,
  isSandboxActive,
  uiStatusLabel,
  lifecycleTiming,
  observabilityData,
}: BuildSandboxActivitySummaryParams): SandboxActivitySummary {
  const recentEvents = (observabilityData?.events ?? [])
    .filter(isSandboxEvent)
    .slice(0, 8);
  const runningEvents = recentEvents.filter((event) =>
    activeStatuses.has(event.status),
  ).length;
  const failedEvents = recentEvents.filter((event) =>
    failedStatuses.has(event.status),
  ).length;
  const runningWorkers =
    observabilityData?.workers.filter((worker) =>
      activeStatuses.has(worker.status),
    ).length ?? 0;
  const activeServices =
    observabilityData?.services.filter((service) =>
      activeServiceStatuses.has(service.status),
    ).length ?? 0;
  const toolUses =
    (observabilityData?.directToolUse.count ?? 0) +
    (observabilityData?.externalToolUse.count ?? 0);
  const lastEventAtMs = newestEventTime(recentEvents);
  const lastActivityAtMs = Math.max(
    lifecycleTiming.lastActivityAtMs ?? 0,
    lastEventAtMs ?? 0,
  );
  const normalizedLastActivityAtMs =
    lastActivityAtMs > 0 ? lastActivityAtMs : null;
  const currentActivity = resolveCurrentActivity({
    data: observabilityData,
    events: recentEvents,
    isSandboxActive,
    hasSnapshot,
  });
  const tone = resolveTone({
    hasSandboxState,
    hasSnapshot,
    isSandboxActive,
    lifecycleState: lifecycleTiming.state,
    failedEvents,
    runningSignals: runningEvents + runningWorkers,
  });

  return {
    label: uiStatusLabel,
    tone,
    description:
      hasSandboxState || hasSnapshot
        ? "Read-only lifecycle, activity, and usage signals from this session."
        : "This chat has no attached sandbox yet.",
    currentActivity,
    sandboxName: resolveSandboxName(observabilityData, recentEvents),
    lastActivityAtMs: normalizedLastActivityAtMs,
    hibernateAfterMs: lifecycleTiming.hibernateAfterMs,
    sandboxExpiresAtMs: lifecycleTiming.sandboxExpiresAtMs,
    lifecycleState: lifecycleTiming.state,
    stats: {
      events: recentEvents.length,
      runningEvents,
      failedEvents,
      workflows: observabilityData?.workflowRuns.length ?? 0,
      workers: observabilityData?.workers.length ?? 0,
      runningWorkers,
      services: observabilityData?.services.length ?? 0,
      activeServices,
      browserRuns: observabilityData?.browserRuns.length ?? 0,
      toolUses,
    },
    recentEvents,
  };
}
