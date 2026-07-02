import type { RunSummary } from "@/lib/background-agents/run-summary";

export type SerializedBackgroundRun = {
  id: string;
  status: string;
  source: string;
  triggerKind: string;
  externalId: string;
  idempotencyKey: string;
  repoOwner: string;
  repoName: string;
  ref: string | null;
  sha: string | null;
  branch: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  deploymentUrl: string | null;
  outputUrl: string | null;
  sandboxName: string | null;
  requestId: string | null;
  workflowRunId: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultSummary?: RunSummary | null;
};

export type SerializedBackgroundAgent = {
  id: string;
  name: string;
  permissions: unknown;
  checkCommand: string | null;
};

export type SerializedBackgroundEvent = {
  id: string;
  eventName: string;
  status: string;
  summary: string | null;
  workflowRunId: string | null;
  sandboxName: string | null;
  requestId: string | null;
  errorKind: string | null;
  redactionStatus: string;
  payload: Record<string, unknown>;
  createdAt: string;
  sequence?: number | null;
};

export type SerializedBackgroundOutput = {
  id: string;
  kind: string;
  status: string;
  url: string | null;
  prNumber: number | null;
};

export type StreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "terminal";

export type BackgroundRunDetailData = {
  run: SerializedBackgroundRun;
  agent: SerializedBackgroundAgent | null;
  events: SerializedBackgroundEvent[];
  outputs: SerializedBackgroundOutput[];
};
