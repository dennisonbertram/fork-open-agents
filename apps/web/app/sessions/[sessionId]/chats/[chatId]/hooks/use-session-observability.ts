"use client";

import useSWR from "swr";
import { fetcherNoStore } from "@/lib/swr";

export type RuntimeMode = "classic" | "managed_runtime";

export type SessionEventJson = {
  id: string;
  sessionId: string;
  chatId: string | null;
  userId: string;
  source: string;
  actorType: string;
  actorId: string | null;
  eventName: string;
  status: string;
  summary: string | null;
  requestId: string | null;
  workflowRunId: string | null;
  harnessRunId: string | null;
  sandboxName: string | null;
  managedRuntimeProfileRunId: string | null;
  serviceId: string | null;
  browserRunId: string | null;
  payload: Record<string, unknown>;
  redactionStatus: string;
  createdAt: string;
};

export type ManagedRuntimeCommandObservationJson = {
  commandId: string;
  label: string;
  status: string;
  required?: boolean;
  exitCode?: number | null;
  durationMs?: number;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
};

export type ManagedRuntimeProfileRunJson = {
  id: string;
  sessionId: string;
  chatId: string | null;
  userId: string;
  workflowRunId: string | null;
  sandboxName: string | null;
  profileId: string;
  profileVersion: string;
  profileDisplayName: string;
  status: string;
  expectedTools: string[];
  optionalTools: string[];
  setupResults: ManagedRuntimeCommandObservationJson[];
  verificationResults: ManagedRuntimeCommandObservationJson[];
  summary: string | null;
  failureMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunJson = {
  id: string;
  chatId: string;
  sessionId: string;
  userId: string;
  modelId: string | null;
  requestId: string | null;
  runtimeMode: RuntimeMode | null;
  sandboxName: string | null;
  managedRuntimeProfileId: string | null;
  managedRuntimeProfileVersion: string | null;
  managedRuntimeProfileRunId: string | null;
  errorMessage: string | null;
  status: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  createdAt: string;
};

export type ManagedRuntimeWorkerJson = {
  id: string;
  // "message" = derived from chat message parts (fallback)
  // "durable"  = read from the managed_runtime_worker_runs DB table
  source: "message" | "durable";
  taskToolCallId: string;
  workerType: string;
  status: string;
  sandboxName: string | null;
  profileId: string | null;
  profileVersion: string | null;
  profileDisplayName: string | null;
  profileRunId: string | null;
  currentToolName: string | null;
  currentToolSummary: string | null;
  toolCallCount: number;
  summary: string | null;
  updatedAt: string | null;
};

export type ManagedRuntimeDirectToolUseJson = {
  observed: boolean;
  count: number;
  toolTypes: string[];
  toolLabels: string[];
  warning: string | null;
};

export type RuntimeServiceJson = {
  id: string;
  kind: string;
  status: string;
  packagePath: string;
  port: number;
  url: string | null;
  logPath: string | null;
  lastHealthStatus: number | null;
  failureMessage: string | null;
};

export type RuntimeBrowserRunJson = {
  id: string;
  status: string;
  targetUrl: string;
  summary: string | null;
  consoleErrors: unknown;
  networkErrors: unknown;
  steps: unknown;
  artifactRefs: unknown;
  redactionStatus: string;
};

export type SessionObservabilityResponse = {
  runtimeMode: RuntimeMode;
  events: SessionEventJson[];
  profileRuns: ManagedRuntimeProfileRunJson[];
  workflowRuns: WorkflowRunJson[];
  workers: ManagedRuntimeWorkerJson[];
  directToolUse: ManagedRuntimeDirectToolUseJson;
  services: RuntimeServiceJson[];
  browserRuns: RuntimeBrowserRunJson[];
};

export function useSessionObservability(params: {
  sessionId: string;
  chatId: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const key = enabled
    ? `/api/sessions/${encodeURIComponent(
        params.sessionId,
      )}/observability?chatId=${encodeURIComponent(params.chatId)}`
    : null;

  return useSWR<SessionObservabilityResponse>(key, fetcherNoStore, {
    refreshInterval: 5000,
    revalidateOnFocus: false,
  });
}
