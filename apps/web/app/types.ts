import type {
  DynamicToolUIPart,
  FinishReason,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
  UIMessage,
} from "ai";
import type { webAgent } from "./config";

export type WebAgent = typeof webAgent;
export type WebAgentCallOptions = Parameters<
  WebAgent["generate"]
>["0"]["options"];

export type WebAgentStepFinishMetadata = {
  finishReason: FinishReason;
  rawFinishReason?: string;
};

export type WebAgentResponseTimelineCategory =
  | "database"
  | "inference"
  | "third_party"
  | "system"
  | "tool";

export type WebAgentResponseTimelineSegment = {
  id: string;
  label: string;
  category: WebAgentResponseTimelineCategory;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  detail?: string;
  measured?: boolean;
};

export type WebAgentResponseTimeline = {
  workflowRunId: string;
  // #1241: mirrors workflowRuns.status, widened with four deliberate-stop
  // values so a stalled or step-capped run isn't reported identically to a
  // crash. #1247 widened it again with "truncated" / "awaiting_tool_approval"
  // / "ended_unexpectedly" — see the doc comment on `WorkflowRunStatus`
  // (lib/chat/workflow-run-outcome.ts). Nothing in this file's consumers
  // switches on the literal value today — it is only ever displayed.
  status:
    | "completed"
    | "aborted"
    | "failed"
    | "no_progress_fuse"
    | "no_sandbox_step_cap"
    | "max_steps"
    | "repeated_tool_failure"
    | "truncated"
    | "awaiting_tool_approval"
    | "ended_unexpectedly";
  totalDurationMs: number;
  startedAt: string;
  finishedAt: string;
  segments: WebAgentResponseTimelineSegment[];
};

export type WebAgentMessageMetadata = {
  selectedModelId?: string;
  modelId?: string;
  inferenceRoute?: "gateway" | "user";
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  inferenceProvider?: string;
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  /** Gateway-reported cost of the most recent step, in USD. */
  lastStepCost?: number;
  /** Cumulative gateway-reported cost across every step of the message, in USD. */
  totalMessageCost?: number;
  /** Persisted wall-clock response duration for completed assistant messages. */
  responseDurationMs?: number;
  /** Measured wall-clock duration spent inside model/inference steps. */
  responseInferenceDurationMs?: number;
  /** Provider-reported throughput, when the provider exposes it. */
  providerTokensPerSecond?: number;
  /** Persisted run-level timing breakdown for this assistant response. */
  responseTimeline?: WebAgentResponseTimeline;
  lastStepFinishReason?: FinishReason;
  lastStepRawFinishReason?: string;
  stepFinishReasons?: WebAgentStepFinishMetadata[];
  /**
   * Set when this assistant turn failed fatally before producing any output.
   * The request that triggered it was never executed. A later, unrelated user
   * message must not be read as license to silently resume it — see
   * `annotateAbandonedTurns` in `@/lib/chat/annotate-abandoned-turns`, which
   * flags this turn to the model on the next conversion.
   */
  abandoned?: boolean;
};

export type WebAgentGitDataStatus = "pending" | "success" | "error" | "skipped";

export type WebAgentCommitData = {
  status: WebAgentGitDataStatus;
  committed?: boolean;
  pushed?: boolean;
  commitMessage?: string;
  commitSha?: string;
  url?: string;
  error?: string;
};

export type WebAgentPrData = {
  status: WebAgentGitDataStatus;
  created?: boolean;
  syncedExisting?: boolean;
  prNumber?: number;
  url?: string;
  error?: string;
  skipReason?: string;
  requiresManualCreation?: boolean;
};

export type WebAgentSnippetData = {
  content: string;
  filename: string;
};

export type WebAgentWorkspaceStatusData = {
  status: "setting-up";
  message: string;
  title?: string;
  logLines?: string[];
  logUpdatedAt?: string;
};

export type WebAgentVerifiedBuildData = {
  status: string;
  runId: string;
  harnessRunId: string;
  mode: "investigation" | "verified_build";
  reason: string;
  requestId: string;
};

export type WebAgentRuntimeProofData = {
  // "no_activity" = a conversational turn where the coordinator answered without
  // running tools or delegating to a worker — nothing to prove (not a failure).
  status: "completed" | "failed" | "blocked" | "incomplete" | "no_activity";
  runtimeMode: "managed_runtime";
  workflowRunId: string;
  sandboxName: string | null;
  profile: {
    id: string;
    version: string;
    displayName: string;
    profileRunId: string | null;
  };
  workerEvidence: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    latest: {
      id: string;
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
      workspaceMode: string | null;
      completionPacketValidationStatus: string | null;
      completionPacketReasonCode: string | null;
      completionPacketSummary: string | null;
      changedFileCount: number;
      verificationCount: number;
      integrationReady: boolean;
    } | null;
  };
  coordinatorDirectToolUse: {
    observed: boolean;
    count: number;
    toolTypes: string[];
    toolLabels: string[];
    warning: string | null;
  };
  externalToolUse: {
    observed: boolean;
    count: number;
    toolNames: string[];
  };
  evidence: string[];
  serviceEvidence: {
    total: number;
    running: number;
    failed: number;
    latest: {
      id: string;
      kind: string;
      status: string;
      packagePath: string;
      port: number;
      url: string | null;
      logPath: string | null;
      lastHealthStatus: number | null;
      failureMessage: string | null;
    } | null;
  };
  browserEvidence: {
    total: number;
    passed: number;
    failed: number;
    latest: {
      id: string;
      status: string;
      targetUrl: string;
      summary: string | null;
      artifactCount: number;
      redactionStatus: string;
    } | null;
  };
  limitations: string[];
};

export type WebAgentDataParts = {
  commit: WebAgentCommitData;
  pr: WebAgentPrData;
  snippet: WebAgentSnippetData;
  "workspace-status": WebAgentWorkspaceStatusData;
  "verified-build": WebAgentVerifiedBuildData;
  "runtime-proof": WebAgentRuntimeProofData;
};

// All types derived from the agent
export type WebAgentTools = WebAgent["tools"];
export type WebAgentUITools = InferUITools<WebAgentTools>;
export type WebAgentUIMessage = UIMessage<
  WebAgentMessageMetadata,
  WebAgentDataParts,
  WebAgentUITools
>;
export type WebAgentUIMessagePart = WebAgentUIMessage["parts"][number];
export type WebAgentCommitDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-commit" }
>;
export type WebAgentPrDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-pr" }
>;
export type WebAgentSnippetDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-snippet" }
>;
export type WebAgentVerifiedBuildDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-verified-build" }
>;
export type WebAgentRuntimeProofDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-runtime-proof" }
>;
export type WebAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<WebAgentUITools>;
