import {
  convertToModelMessages,
  type FinishReason,
  generateId as generateIdAi,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  pruneMessages,
  type UIMessageChunk,
} from "ai";
import {
  toAnthropicDirectModelId,
  type AgentModelSelection,
  type OpenAgentCallOptions,
} from "@open-agents/agent";
import { getComposioUserFacingError } from "@/lib/composio/errors";
import type { BrowserRunResponse } from "@/lib/sandbox/runtime/browser-runs";
import type { ManagedServiceResponse } from "@/lib/sandbox/runtime/service-launch";
import { getWorkflowMetadata, getWritable } from "workflow";
import { getRun } from "workflow/api";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";
import { addLanguageModelUsage } from "./usage-utils";
import { extractGatewayCost } from "./gateway-metadata";
import type {
  WebAgentCommitData,
  WebAgentCommitDataPart,
  WebAgentMessageMetadata,
  WebAgentPrData,
  WebAgentPrDataPart,
  WebAgentRuntimeProofData,
  WebAgentRuntimeProofDataPart,
  WebAgentStepFinishMetadata,
  WebAgentUIMessage,
} from "@/app/types";
import {
  claimActiveStream,
  closeStream,
  clearActiveStream,
  hasAutoCommitChangesStep,
  persistAssistantMessage,
  persistAssistantMessageWithToolResults,
  persistSandboxState,
  persistUserMessage,
  recordWorkflowUsage,
  refreshDiffCache,
  refreshLifecycleActivity,
  runAutoCommitStep,
  runAutoCreatePrStep,
  sendFinish,
} from "./chat-post-finish";
import { dedupeMessageReasoning } from "@/lib/chat/dedupe-message-reasoning";
import { getAllVariants } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import type { InferenceRoute } from "@/lib/inference/types";
import type { RecordSessionEventInput } from "@/lib/observability/events";
import type { Session as AuthSession } from "@/lib/session/types";
import type {
  WorkflowRunStatus,
  WorkflowRunStepTiming,
} from "@/lib/db/workflow-runs";
import {
  extractManagedRuntimeWorkersFromParts,
  summarizeManagedRuntimeDirectToolUse,
  type ManagedRuntimeWorkerSnapshot,
} from "@/lib/observability/managed-runtime-workers";
import { resolveChatModelSelection } from "../api/chat/_lib/model-selection";
import {
  resolveChatSandboxRuntime,
  type SandboxBackedRuntime,
} from "./chat-sandbox-runtime";

type AuthSessionContext = Pick<AuthSession, "authProvider" | "user"> | null;

type Options = {
  messages: WebAgentUIMessage[];
  chatId: string;
  sessionId: string;
  userId: string;
  requestUrl: string;
  requestId?: string;
  authSession: AuthSessionContext;
  selectedModelId?: string;
  modelId?: string;
  agentOptions?: Omit<OpenAgentCallOptions, "sandbox" | "skills">;
  maxSteps?: number;
  autoCommitEnabled?: boolean;
  autoCreatePrEnabled?: boolean;
};

type ChatModelRuntime = {
  selectedModelId: string;
  modelId: string;
  inferenceRoute: InferenceRoute;
  inferenceProfileId: string | null;
  inferenceProfileName: string | null;
  inferenceProvider: string | null;
  agentOptions: Omit<OpenAgentCallOptions, "sandbox" | "skills">;
  autoCommitEnabled: boolean;
  autoCreatePrEnabled: boolean;
};

type Writable = WritableStream<UIMessageChunk>;

const shouldPauseForToolInteraction = (parts: WebAgentUIMessage["parts"]) =>
  parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "input-available" || part.state === "approval-requested"),
  );

const DIFF_REFRESHING_TOOL_TYPES = new Set([
  "tool-write",
  "tool-edit",
  "tool-bash",
]);

function shouldRefreshDiffCacheForParts(
  parts: WebAgentUIMessage["parts"],
): boolean {
  return parts.some(
    (part) =>
      isToolUIPart(part) &&
      DIFF_REFRESHING_TOOL_TYPES.has(part.type) &&
      (part.state === "output-available" || part.state === "output-error"),
  );
}

const convertMessages = async (
  messages: WebAgentUIMessage[],
): Promise<ModelMessage[]> => {
  "use step";
  const { webAgent } = await import("@/app/config");
  const dedupedMessages = messages.map(dedupeMessageReasoning);
  const modelMessages = await convertToModelMessages<WebAgentUIMessage>(
    dedupedMessages,
    {
      ignoreIncompleteToolCalls: true,
      tools: webAgent.tools,
      convertDataPart: (part) => {
        if (part.type === "data-snippet") {
          const { filename, content } = part.data;
          return {
            type: "text",
            text: JSON.stringify({ type: "snippet", filename, content }),
          };
        }
        return undefined;
      },
    },
  );

  return pruneMessages({
    messages: modelMessages,
    emptyMessages: "remove",
  });
};

async function resolveChatModelRuntime(params: {
  userId: string;
  sessionId: string;
  chatId: string;
  requestUrl: string;
  authSession: AuthSessionContext;
}): Promise<ChatModelRuntime> {
  "use step";

  const [
    { getChatById, getSessionById },
    { getUserPreferences },
    { getInferenceProfileByIdForUser },
  ] = await Promise.all([
    import("@/lib/db/sessions"),
    import("@/lib/db/user-preferences"),
    import("@/lib/db/inference-profiles"),
  ]);
  const [sessionRecord, chat, rawPreferences] = await Promise.all([
    getSessionById(params.sessionId),
    getChatById(params.chatId),
    getUserPreferences(params.userId).catch((error) => {
      console.error("Failed to load user preferences:", error);
      return null;
    }),
  ]);

  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (!chat || chat.sessionId !== params.sessionId) {
    throw new Error("Chat not found");
  }

  const preferences = rawPreferences;
  const modelVariants = getAllVariants(preferences?.modelVariants ?? []);
  const selectedModelId = chat.modelId ?? null;
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;
  const autoCommitEnabled =
    (sessionRecord.autoCommitPushOverride ??
      preferences?.autoCommitPush ??
      false) &&
    Boolean(sessionRecord.repoOwner && sessionRecord.repoName);
  const autoCreatePrEnabled =
    autoCommitEnabled &&
    (sessionRecord.autoCreatePrOverride ?? preferences?.autoCreatePr ?? false);
  const inferenceProfileId =
    chat.inferenceProfileId ??
    sessionRecord.inferenceProfileId ??
    preferences?.defaultInferenceProfileId ??
    null;
  let inferenceRoute: InferenceRoute = "gateway";
  let inferenceProfileName: string | null = null;
  let inferenceProvider: string | null = null;

  if (inferenceProfileId) {
    const profile = await getInferenceProfileByIdForUser(
      params.userId,
      inferenceProfileId,
    );
    if (!profile || !profile.enabled) {
      const { InferenceProfileResolutionError } =
        await import("@/lib/inference/profile-resolution");
      throw new InferenceProfileResolutionError(
        "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
      );
    }

    if (!toAnthropicDirectModelId(mainModelSelection.id)) {
      const { InferenceProfileResolutionError } =
        await import("@/lib/inference/profile-resolution");
      throw new InferenceProfileResolutionError(
        "Selected inference profile only supports Anthropic models. Choose an Anthropic User model or switch back to Vercel AI Gateway.",
      );
    }

    inferenceRoute = "user";
    inferenceProfileName = profile.name;
    inferenceProvider = profile.provider;
  }

  return {
    selectedModelId: getModelOptionSelectionId(
      selectedModelId ?? mainModelSelection.id,
      inferenceProfileId,
    ),
    modelId: mainModelSelection.id,
    inferenceRoute,
    inferenceProfileId,
    inferenceProfileName,
    inferenceProvider,
    agentOptions: {
      model: mainModelSelection,
      ...(subagentModelSelection
        ? { subagentModel: subagentModelSelection }
        : {}),
      customInstructions: assistantFileLinkPrompt,
    },
    autoCommitEnabled,
    autoCreatePrEnabled,
  };
}

const generateId = async () => {
  "use step";
  return generateIdAi();
};

async function emitWorkflowSessionEvent(
  input: RecordSessionEventInput,
): Promise<void> {
  "use step";

  const { emitSessionEvent } = await import("@/lib/observability/events");
  await emitSessionEvent(input);
}

async function startGoalLedger(input: {
  userId: string;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  objective: string;
}): Promise<string | null> {
  "use step";

  const { recordGoalLedgerStart } =
    await import("@/lib/workflows/goal-ledger-recorder");
  return recordGoalLedgerStart(input);
}

async function appendGoalLedgerEvent(input: {
  goalId: string;
  userId: string;
  eventType: import("@/lib/workflows/goal-ledger-recorder").GoalLedgerEventType;
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  "use step";

  const { recordGoalLedgerEvent } =
    await import("@/lib/workflows/goal-ledger-recorder");
  await recordGoalLedgerEvent(input);
}

async function closeGoalLedger(input: {
  goalId: string;
  terminalStatus: "complete" | "canceled" | "failed" | "archived";
}): Promise<void> {
  "use step";

  const { recordGoalLedgerClose } =
    await import("@/lib/workflows/goal-ledger-recorder");
  await recordGoalLedgerClose(input);
}

/**
 * Validate a goal before closing as "complete".
 *
 * Uses "use step" so Workflow memoization applies on replay. This is the
 * integration point for issue #38's evidence-validation requirement.
 *
 * NOTE: `requireEvidence` is always `false` today because goals are not yet
 * linked to proof levels — so this call is a no-op in production. It WILL
 * start enforcing when a future slice wires proof levels. The blocked branch
 * is exercised by the chat integration test (forced mock).
 */
async function validateGoalForClose(input: {
  goalId: string;
  userId: string;
  terminalStatus: string;
}): Promise<{ ok: boolean; reason?: string }> {
  "use step";

  const { validateGoalCompletion } =
    await import("@/lib/workflows/goal-validation");

  // evidenceRefs: currently always [] — goals are not yet linked to evidence.
  // requireEvidence: always false — proof level is not yet linked to goals.
  const result = validateGoalCompletion({
    status: input.terminalStatus,
    evidenceRefs: [],
    requireEvidence: false,
  });

  if (result.ok) {
    return { ok: true };
  }

  return { ok: false, reason: result.reason };
}

async function persistInputMessages(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  "use step";

  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return;
  }

  await Promise.all([
    persistUserMessage(chatId, latestMessage),
    persistAssistantMessageWithToolResults(chatId, latestMessage),
  ]);
}

function buildStepTiming(
  stepNumber: number,
  startedAt: Date,
  finishedAt: Date,
  finishReason?: string,
  rawFinishReason?: string,
): WorkflowRunStepTiming {
  return {
    stepNumber,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    finishReason,
    rawFinishReason,
  };
}

function withModelMetadata(
  metadata: WebAgentMessageMetadata | undefined,
  selectedModelId: string,
  modelId: string,
  inference?: {
    inferenceRoute: InferenceRoute;
    inferenceProfileId: string | null;
    inferenceProfileName: string | null;
    inferenceProvider: string | null;
  },
): WebAgentMessageMetadata {
  return {
    ...metadata,
    selectedModelId,
    modelId,
    ...(inference
      ? {
          inferenceRoute: inference.inferenceRoute,
          ...(inference.inferenceProfileId
            ? { inferenceProfileId: inference.inferenceProfileId }
            : {}),
          ...(inference.inferenceProfileName
            ? { inferenceProfileName: inference.inferenceProfileName }
            : {}),
          ...(inference.inferenceProvider
            ? { inferenceProvider: inference.inferenceProvider }
            : {}),
        }
      : {}),
  };
}

function getSetupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (message.includes("Connect GitHub")) {
    return "Connect GitHub to access this repository, then try again.";
  }

  if (message === "Session is archived") {
    return "This session is archived. Unarchive it to continue.";
  }

  if (name === "WorkspaceSetupError") {
    return message;
  }

  if (name === "InferenceProfileResolutionError") {
    return message;
  }

  if (
    name === "ComposioSetupError" ||
    message.includes("Composio") ||
    message.includes("COMPOSIO_API_KEY") ||
    message.includes("Invalid API key") ||
    message.includes('"code":10401') ||
    message.includes("HTTP_Unauthorized")
  ) {
    return getComposioUserFacingError(message);
  }

  return "Workspace setup failed. Try again in a moment.";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getUserFacingWorkflowErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);

  if (
    message.includes("Free credits temporarily have restricted access") ||
    message.includes("RestrictedModelsError") ||
    message.includes("no_providers_available")
  ) {
    return "The model call failed in Vercel AI Gateway because free credits are temporarily restricted for this project. Add paid AI Gateway credits or switch to a model/provider with available credits, then retry.";
  }

  return getSetupErrorMessage(error);
}

function isStepTimingError(
  error: unknown,
): error is Error & { stepTiming: WorkflowRunStepTiming } {
  return (
    error instanceof Error &&
    "stepTiming" in error &&
    typeof error.stepTiming === "object" &&
    error.stepTiming !== null
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function summarizeContentTypes(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.slice(0, 8).map((part) => {
      if (isObjectRecord(part) && typeof part.type === "string") {
        return part.type;
      }

      return typeof part;
    });
  }

  if (typeof content === "string") {
    return ["text"];
  }

  if (content === undefined) {
    return undefined;
  }

  return [typeof content];
}

function summarizeRequestTool(tool: unknown): unknown {
  if (!isObjectRecord(tool)) {
    return tool === undefined ? undefined : { type: typeof tool };
  }

  return compactRecord({
    type: typeof tool.type === "string" ? tool.type : undefined,
    name: typeof tool.name === "string" ? tool.name : undefined,
    strict: typeof tool.strict === "boolean" ? tool.strict : undefined,
  });
}

function summarizeRequestInputItem(item: unknown): unknown {
  if (!isObjectRecord(item)) {
    return { type: typeof item };
  }

  return compactRecord({
    type:
      typeof item.type === "string"
        ? item.type
        : typeof item.role === "string"
          ? "message"
          : undefined,
    role: typeof item.role === "string" ? item.role : undefined,
    contentTypes: summarizeContentTypes(item.content),
  });
}

function summarizeRequestBody(body: unknown): unknown {
  if (!isObjectRecord(body)) {
    return body === undefined ? undefined : { type: typeof body };
  }

  const input = Array.isArray(body.input) ? body.input : undefined;
  const tools = Array.isArray(body.tools) ? body.tools : undefined;

  return compactRecord({
    model: typeof body.model === "string" ? body.model : undefined,
    stream: typeof body.stream === "boolean" ? body.stream : undefined,
    store: typeof body.store === "boolean" ? body.store : undefined,
    previousResponseId:
      typeof body.previous_response_id === "string"
        ? body.previous_response_id
        : undefined,
    maxOutputTokens:
      typeof body.max_output_tokens === "number"
        ? body.max_output_tokens
        : undefined,
    maxCompletionTokens:
      typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : undefined,
    temperature:
      typeof body.temperature === "number" ? body.temperature : undefined,
    topP: typeof body.top_p === "number" ? body.top_p : undefined,
    truncation:
      typeof body.truncation === "string" ? body.truncation : undefined,
    toolChoice: body.tool_choice,
    parallelToolCalls:
      typeof body.parallel_tool_calls === "boolean"
        ? body.parallel_tool_calls
        : undefined,
    reasoning: isObjectRecord(body.reasoning) ? body.reasoning : undefined,
    text: isObjectRecord(body.text) ? body.text : undefined,
    include: Array.isArray(body.include) ? body.include : undefined,
    inputCount: input?.length,
    inputSummary: input?.slice(0, 6).map(summarizeRequestInputItem),
    toolsCount: tools?.length,
    tools: tools?.slice(0, 6).map(summarizeRequestTool),
  });
}

function summarizeResponseOutputItem(item: unknown): unknown {
  if (!isObjectRecord(item)) {
    return { type: typeof item };
  }

  return compactRecord({
    type: typeof item.type === "string" ? item.type : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    role: typeof item.role === "string" ? item.role : undefined,
    id: typeof item.id === "string" ? item.id : undefined,
    contentTypes: summarizeContentTypes(item.content),
  });
}

function summarizeResponseBody(body: unknown): unknown {
  if (!isObjectRecord(body)) {
    return body === undefined ? undefined : { type: typeof body };
  }

  const output = Array.isArray(body.output) ? body.output : undefined;

  return compactRecord({
    id: typeof body.id === "string" ? body.id : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    incompleteDetails: isObjectRecord(body.incomplete_details)
      ? body.incomplete_details
      : undefined,
    error: body.error,
    outputCount: output?.length,
    outputSummary: output?.slice(0, 8).map(summarizeResponseOutputItem),
    usage: isObjectRecord(body.usage) ? body.usage : undefined,
    serviceTier:
      typeof body.service_tier === "string" ? body.service_tier : undefined,
  });
}

function stringifyDebugPayload(value: unknown): string {
  const seen = new WeakSet<object>();

  return (
    JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "bigint") {
          return currentValue.toString();
        }

        if (typeof currentValue === "object" && currentValue !== null) {
          if (seen.has(currentValue)) {
            return "[Circular]";
          }

          seen.add(currentValue);
        }

        return currentValue;
      },
      2,
    ) ?? "undefined"
  );
}

function buildGitHubCommitUrl(
  repoOwner: string,
  repoName: string,
  commitSha: string,
): string {
  return `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commit/${encodeURIComponent(commitSha)}`;
}

function buildCommitData(
  result: Awaited<ReturnType<typeof runAutoCommitStep>>,
  repoOwner: string,
  repoName: string,
): WebAgentCommitData {
  if (result.error) {
    return {
      status: "error",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
      error: result.error,
    };
  }

  if (result.committed) {
    return {
      status: "success",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
    };
  }

  return {
    status: "skipped",
    committed: false,
    pushed: false,
  };
}

function buildPrData(
  result: Awaited<ReturnType<typeof runAutoCreatePrStep>>,
): WebAgentPrData {
  if (result.error) {
    return {
      status: "error",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      error: result.error,
    };
  }

  if (result.skipped) {
    return {
      status: "skipped",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      skipReason: result.skipReason,
    };
  }

  return {
    status: "success",
    created: result.created,
    syncedExisting: result.syncedExisting,
    prNumber: result.prNumber,
    url: result.prUrl,
  };
}

function buildRuntimeProofData(params: {
  workflowRunId: string;
  workflowStatus: WorkflowRunStatus;
  sandboxName: string | null;
  managedRuntime: NonNullable<SandboxBackedRuntime["managedRuntime"]>;
  assistantParts: WebAgentUIMessage["parts"];
  artifacts: RuntimeProofArtifacts;
}): WebAgentRuntimeProofData {
  const workers = extractManagedRuntimeWorkersFromParts(params.assistantParts);
  const workerEvidence = summarizeRuntimeWorkerEvidence(workers);
  const coordinatorDirectToolUse = summarizeManagedRuntimeDirectToolUse(
    params.assistantParts,
  );
  const serviceEvidence = summarizeRuntimeServiceEvidence(
    params.artifacts.services,
  );
  const browserEvidence = summarizeRuntimeBrowserEvidence(
    params.artifacts.browserRuns,
  );
  const evidence = [
    "Managed runtime was selected for this workflow.",
    "Workflow, sandbox, and profile run attribution were recorded.",
    "Profile setup/probe details are available in Runtime Inspector.",
  ];
  const limitations: string[] = [];

  if (workerEvidence.latest === null) {
    limitations.push(
      "Managed runtime was selected, but no managed worker executed for this turn.",
    );
  } else {
    evidence.push(formatWorkerEvidenceSummary(workerEvidence.latest));
    if (workerEvidence.failed > 0) {
      limitations.push("One or more managed workers failed.");
    }
    if (workerEvidence.completed === 0) {
      limitations.push("No completed managed worker evidence was captured.");
    }
  }

  if (coordinatorDirectToolUse.warning) {
    limitations.push(coordinatorDirectToolUse.warning);
  }

  if (serviceEvidence.latest === null) {
    limitations.push(
      "Service/dev-server evidence is captured only when a managed service is started.",
    );
  } else if (serviceEvidence.running === 0) {
    limitations.push("No running managed service was recorded.");
  } else {
    evidence.push(formatServiceEvidenceSummary(serviceEvidence.latest));
  }

  if (browserEvidence.latest === null) {
    limitations.push(
      "Browser/screenshot evidence is captured only when a browser check is run.",
    );
  } else if (browserEvidence.passed === 0) {
    limitations.push("No passed browser/screenshot check was recorded.");
  } else {
    evidence.push(formatBrowserEvidenceSummary(browserEvidence.latest));
  }

  if (params.artifacts.errorMessage) {
    limitations.push(
      `Runtime service/browser evidence lookup failed: ${params.artifacts.errorMessage}`,
    );
  }

  if (
    !params.managedRuntime.profileId ||
    !params.managedRuntime.profileVersion ||
    !params.managedRuntime.profileDisplayName
  ) {
    limitations.push("Managed runtime profile metadata was incomplete.");
  }

  if (!params.managedRuntime.profileRunId) {
    limitations.push("No managed runtime profile run id was recorded.");
  }

  const proofStatus = getRuntimeProofStatus({
    workflowStatus: params.workflowStatus,
    workerEvidence,
    coordinatorDirectToolUseObserved: coordinatorDirectToolUse.observed,
  });

  return {
    status: proofStatus,
    runtimeMode: "managed_runtime",
    workflowRunId: params.workflowRunId,
    sandboxName: params.sandboxName,
    profile: {
      id: params.managedRuntime.profileId ?? "unknown",
      version: params.managedRuntime.profileVersion ?? "unknown",
      displayName:
        params.managedRuntime.profileDisplayName ?? "Unknown managed profile",
      profileRunId: params.managedRuntime.profileRunId ?? null,
    },
    workerEvidence,
    coordinatorDirectToolUse,
    evidence,
    serviceEvidence,
    browserEvidence,
    limitations,
  };
}

type RuntimeProofArtifacts = {
  services: ManagedServiceResponse[];
  browserRuns: BrowserRunResponse[];
  errorMessage: string | null;
};

const EMPTY_RUNTIME_PROOF_ARTIFACTS: RuntimeProofArtifacts = {
  services: [],
  browserRuns: [],
  errorMessage: null,
};

function getRuntimeProofStatus(params: {
  workflowStatus: WorkflowRunStatus;
  workerEvidence: WebAgentRuntimeProofData["workerEvidence"];
  coordinatorDirectToolUseObserved: boolean;
}): WebAgentRuntimeProofData["status"] {
  if (params.workflowStatus === "failed") {
    return "failed";
  }

  if (params.workflowStatus === "aborted") {
    return "blocked";
  }

  if (
    params.workerEvidence.completed === 0 ||
    params.workerEvidence.failed > 0 ||
    params.coordinatorDirectToolUseObserved
  ) {
    return "incomplete";
  }

  return "completed";
}

function summarizeRuntimeWorkerEvidence(
  workers: ManagedRuntimeWorkerSnapshot[],
): WebAgentRuntimeProofData["workerEvidence"] {
  const latest = workers[0] ?? null;

  return {
    total: workers.length,
    completed: workers.filter((worker) => worker.status === "completed").length,
    failed: workers.filter((worker) => worker.status === "failed").length,
    running: workers.filter((worker) => worker.status === "running").length,
    latest: latest
      ? {
          id: latest.id,
          workerType: latest.workerType,
          status: latest.status,
          sandboxName: latest.sandboxName,
          profileId: latest.profileId,
          profileVersion: latest.profileVersion,
          profileDisplayName: latest.profileDisplayName,
          profileRunId: latest.profileRunId,
          currentToolName: latest.currentToolName,
          currentToolSummary: latest.currentToolSummary,
          toolCallCount: latest.toolCallCount,
          summary: latest.summary,
        }
      : null,
  };
}

function getArtifactCount(artifactRefs: unknown): number {
  return Array.isArray(artifactRefs) ? artifactRefs.length : 0;
}

function summarizeRuntimeServiceEvidence(
  services: ManagedServiceResponse[],
): WebAgentRuntimeProofData["serviceEvidence"] {
  const latest = services[0] ?? null;

  return {
    total: services.length,
    running: services.filter((service) => service.status === "running").length,
    failed: services.filter((service) => service.status === "failed").length,
    latest: latest
      ? {
          id: latest.id,
          kind: latest.kind,
          status: latest.status,
          packagePath: latest.packagePath,
          port: latest.port,
          url: latest.url,
          logPath: latest.logPath,
          lastHealthStatus: latest.lastHealthStatus,
          failureMessage: latest.failureMessage,
        }
      : null,
  };
}

function summarizeRuntimeBrowserEvidence(
  browserRuns: BrowserRunResponse[],
): WebAgentRuntimeProofData["browserEvidence"] {
  const latest = browserRuns[0] ?? null;

  return {
    total: browserRuns.length,
    passed: browserRuns.filter((run) => run.status === "passed").length,
    failed: browserRuns.filter((run) => run.status === "failed").length,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          targetUrl: latest.targetUrl,
          summary: latest.summary,
          artifactCount: getArtifactCount(latest.artifactRefs),
          redactionStatus: latest.redactionStatus,
        }
      : null,
  };
}

function formatServiceEvidenceSummary(
  service: NonNullable<WebAgentRuntimeProofData["serviceEvidence"]["latest"]>,
): string {
  const healthSuffix =
    typeof service.lastHealthStatus === "number"
      ? ` (HTTP ${service.lastHealthStatus})`
      : "";
  return `Managed dev-server evidence recorded: ${service.id} ${service.status} on port ${service.port}${healthSuffix}.`;
}

function formatWorkerEvidenceSummary(
  worker: NonNullable<WebAgentRuntimeProofData["workerEvidence"]["latest"]>,
): string {
  const sandboxSuffix = worker.sandboxName
    ? ` in sandbox ${worker.sandboxName}`
    : "";
  const toolSuffix =
    worker.toolCallCount > 0
      ? ` with ${worker.toolCallCount} tool call${
          worker.toolCallCount === 1 ? "" : "s"
        }`
      : "";

  return `Managed worker evidence recorded: ${worker.workerType} ${worker.status}${sandboxSuffix}${toolSuffix}.`;
}

function formatBrowserEvidenceSummary(
  browserRun: NonNullable<
    WebAgentRuntimeProofData["browserEvidence"]["latest"]
  >,
): string {
  return `Browser/screenshot evidence recorded: ${browserRun.id} ${browserRun.status} with ${browserRun.artifactCount} artifact${
    browserRun.artifactCount === 1 ? "" : "s"
  }.`;
}

async function collectRuntimeProofArtifacts(params: {
  sessionId: string;
  chatId: string;
}): Promise<RuntimeProofArtifacts> {
  "use step";

  try {
    const [serviceModule, browserModule] = await Promise.all([
      import("@/lib/sandbox/runtime/service-launch"),
      import("@/lib/sandbox/runtime/browser-runs"),
    ]);
    const [services, browserRuns] = await Promise.all([
      serviceModule.listManagedServices({ sessionId: params.sessionId }),
      browserModule.listManagedBrowserRuns({
        sessionId: params.sessionId,
        chatId: params.chatId,
      }),
    ]);

    return {
      services,
      browserRuns,
      errorMessage: null,
    };
  } catch (error) {
    return {
      ...EMPTY_RUNTIME_PROOF_ARTIFACTS,
      errorMessage: getErrorMessage(error),
    };
  }
}

function upsertAssistantDataPart(
  message: WebAgentUIMessage,
  part:
    | WebAgentCommitDataPart
    | WebAgentPrDataPart
    | WebAgentRuntimeProofDataPart,
): WebAgentUIMessage {
  const nextParts = [...message.parts];
  const existingIndex = nextParts.findIndex(
    (messagePart) =>
      messagePart.type === part.type && messagePart.id === part.id,
  );

  if (existingIndex >= 0) {
    nextParts[existingIndex] = part;
  } else {
    nextParts.push(part);
  }

  return {
    ...message,
    parts: nextParts,
  };
}

async function sendDataPart(
  writable: Writable,
  part:
    | WebAgentCommitDataPart
    | WebAgentPrDataPart
    | WebAgentRuntimeProofDataPart,
) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write(part);
  } finally {
    writer.releaseLock();
  }
}

export async function runAgentWorkflow(options: Options) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const writable = getWritable<UIMessageChunk>();
  const emitSessionEvent = emitWorkflowSessionEvent;

  const latestMessage = options.messages.at(-1);

  if (latestMessage == null) {
    throw new Error("runAgentWorkflow requires at least one message");
  }

  const runStartedAt = new Date();
  await emitSessionEvent({
    sessionId: options.sessionId,
    chatId: options.chatId,
    userId: options.userId,
    source: "workflow",
    actorType: "workflow",
    eventName: "workflow.started",
    status: "started",
    summary: "Agent workflow started.",
    requestId: options.requestId ?? null,
    workflowRunId,
    payload: {
      messageCount: options.messages.length,
      maxSteps: options.maxSteps ?? null,
    },
  });

  // Self-register this workflow's runId onto the chat as the very first step.
  // The HTTP POST handler also writes this (via compareAndSetChatActiveStreamId
  // after `start()` returns), but that write is best-effort and can be lost
  // when the client disconnects early and the function is torn down before
  // it runs. Persisting from inside the workflow guarantees that as long as
  // the workflow is running, the chat row points at it and the client can
  // resume on refresh.
  const activeStreamClaim = await claimActiveStream(
    options.chatId,
    workflowRunId,
  );
  if (activeStreamClaim === "conflict") {
    await emitSessionEvent({
      sessionId: options.sessionId,
      chatId: options.chatId,
      userId: options.userId,
      source: "workflow",
      actorType: "workflow",
      eventName: "workflow.skipped.active_stream_conflict",
      status: "skipped",
      summary: "Another workflow already owns this chat stream.",
      requestId: options.requestId ?? null,
      workflowRunId,
    });
    // Another workflow claimed the slot while this run was queued or starting.
    // Exit before emitting chunks or persisting messages so only the owning
    // workflow can mutate this chat.
    await closeStream(writable);
    return;
  }

  const modelMessagesPromise = convertMessages(options.messages);
  const inputMessagesPersistPromise = persistInputMessages(
    options.chatId,
    options.messages,
  );
  const assistantId =
    latestMessage.role === "assistant" ? latestMessage.id : await generateId();
  let selectedModelId = APP_DEFAULT_MODEL_ID;
  let modelId = APP_DEFAULT_MODEL_ID;

  let pendingAssistantResponse: WebAgentUIMessage =
    latestMessage.role === "assistant"
      ? {
          ...latestMessage,
          metadata: withModelMetadata(
            latestMessage.metadata,
            selectedModelId,
            modelId,
          ),
          parts: [...latestMessage.parts],
        }
      : {
          role: "assistant",
          id: assistantId,
          parts: [],
          metadata: withModelMetadata(undefined, selectedModelId, modelId),
        };

  let originalMessagesForStep: WebAgentUIMessage[] = [latestMessage];

  const previousResponseMessage =
    latestMessage.role === "assistant" ? latestMessage : undefined;
  const stepTimings: WorkflowRunStepTiming[] = [];
  let wasAborted = false;
  let exhaustedMaxSteps = false;
  let totalUsage: LanguageModelUsage | undefined;
  let finalFinishReason: FinishReason | undefined;
  let streamClosed = false;
  let workflowStatus: WorkflowRunStatus = "completed";
  let caughtError: unknown;
  let sandboxState: OpenAgentCallOptions["sandbox"]["state"] | undefined;
  let shouldRefreshCachedDiff = false;
  let runtimeMode: "classic" | "managed_runtime" | null = null;
  // Goal ledger tracking — null until recordGoalLedgerStart resolves.
  let goalLedgerId: string | null = null;
  let runtimeSandboxName: string | null = null;
  let managedRuntimeProfileId: string | null = null;
  let managedRuntimeProfileVersion: string | null = null;
  let managedRuntimeProfileRunId: string | null = null;
  let inferenceRoute: InferenceRoute = "gateway";
  let inferenceProfileId: string | null = null;
  let inferenceProfileName: string | null = null;
  let inferenceProvider: string | null = null;

  // FIX 2: Start the goal ledger early — before the sandbox/model Promise.all —
  // so that setup-phase failures are still captured in the ledger (the finally
  // block will close it with "failed" status even when setup throws). Guarded
  // best-effort: a failure here must not crash the workflow.
  try {
    const lastUserMessage = options.messages.findLast((m) => m.role === "user");
    const textPart = lastUserMessage?.parts.find((p) => p.type === "text");
    const rawObjective =
      typeof textPart === "object" &&
      textPart !== null &&
      "text" in textPart &&
      typeof textPart.text === "string"
        ? textPart.text.slice(0, 200)
        : `Workflow run ${workflowRunId}`;
    goalLedgerId = await startGoalLedger({
      userId: options.userId,
      sessionId: options.sessionId,
      chatId: options.chatId,
      workflowRunId,
      objective: rawObjective,
    });
    // FIX 1: Record the "started" event immediately after the goal row is created.
    if (goalLedgerId) {
      try {
        await appendGoalLedgerEvent({
          goalId: goalLedgerId,
          userId: options.userId,
          eventType: "started",
          summary: rawObjective || "Workflow run started",
          payload: { workflowRunId },
        });
      } catch (startedErr: unknown) {
        console.error(
          "[chat] goal-ledger started event failed (non-fatal):",
          startedErr,
        );
      }
    }
  } catch (err: unknown) {
    console.error("[chat] goal-ledger start failed (non-fatal):", err);
    goalLedgerId = null;
  }

  try {
    const [runtime, modelRuntime, modelMessages] = await Promise.all([
      resolveChatSandboxRuntime({
        userId: options.userId,
        sessionId: options.sessionId,
        chatId: options.chatId,
        assistantId,
        workflowRunId,
      }),
      resolveChatModelRuntime({
        userId: options.userId,
        sessionId: options.sessionId,
        chatId: options.chatId,
        requestUrl: options.requestUrl,
        authSession: options.authSession,
      }),
      modelMessagesPromise,
      inputMessagesPersistPromise,
    ]);
    selectedModelId = options.selectedModelId ?? modelRuntime.selectedModelId;
    modelId = options.modelId ?? modelRuntime.modelId;
    inferenceRoute = modelRuntime.inferenceRoute;
    inferenceProfileId = modelRuntime.inferenceProfileId;
    inferenceProfileName = modelRuntime.inferenceProfileName;
    inferenceProvider = modelRuntime.inferenceProvider;
    runtimeMode = runtime.runtimeMode;
    // sandboxState is null for sandbox-free sessions; keep as undefined so
    // subsequent guards that check `sandboxState` (persist, refresh, etc.) skip
    // sandbox-specific work correctly.
    runtimeSandboxName =
      runtime.mode === "sandbox"
        ? (runtime.sandboxState.sandboxName ?? null)
        : null;
    managedRuntimeProfileId =
      runtime.mode === "sandbox"
        ? (runtime.managedRuntime?.profileId ?? null)
        : null;
    managedRuntimeProfileVersion =
      runtime.mode === "sandbox"
        ? (runtime.managedRuntime?.profileVersion ?? null)
        : null;
    managedRuntimeProfileRunId =
      runtime.mode === "sandbox"
        ? (runtime.managedRuntime?.profileRunId ?? null)
        : null;
    await emitSessionEvent({
      sessionId: options.sessionId,
      chatId: options.chatId,
      userId: options.userId,
      source: "workflow",
      actorType: "workflow",
      eventName: "workflow.runtime.resolved",
      status: "succeeded",
      summary:
        runtime.runtimeMode === "managed_runtime"
          ? "Managed runtime context is active for this workflow."
          : "Classic runtime context is active for this workflow.",
      requestId: options.requestId ?? null,
      workflowRunId,
      sandboxName: runtimeSandboxName,
      managedRuntimeProfileRunId,
      payload: {
        runtimeMode: runtime.runtimeMode,
        sandboxName: runtimeSandboxName,
        workingDirectory:
          runtime.mode === "sandbox" ? runtime.workingDirectory : null,
        currentBranch:
          runtime.mode === "sandbox" ? runtime.currentBranch : null,
        managedRuntime:
          runtime.mode === "sandbox" ? (runtime.managedRuntime ?? null) : null,
        selectedModelId,
        modelId,
        inferenceRoute,
        inferenceProfileId,
        inferenceProfileName,
        inferenceProvider,
        skillCount: runtime.skills.length,
      },
    });
    pendingAssistantResponse = {
      ...pendingAssistantResponse,
      metadata: withModelMetadata(
        pendingAssistantResponse.metadata,
        selectedModelId,
        modelId,
        {
          inferenceRoute,
          inferenceProfileId,
          inferenceProfileName,
          inferenceProvider,
        },
      ),
    };

    const managedRuntimeAgentContext =
      runtime.mode === "sandbox"
        ? (runtime.managedRuntime ??
          (runtime.runtimeMode === "managed_runtime"
            ? { sandboxName: runtime.sandboxState.sandboxName }
            : undefined))
        : undefined;
    const agentOptions: OpenAgentCallOptions = {
      ...modelRuntime.agentOptions,
      ...options.agentOptions,
      runtimeMode: runtime.runtimeMode,
      // Signal to the agent that there is no sandbox VM; the tool policy will
      // exclude all sandbox-dependent tools (file/bash/exec/edit/task).
      sandboxFree: runtime.mode === "sandbox-free",
      ...(managedRuntimeAgentContext
        ? { managedRuntime: managedRuntimeAgentContext }
        : {}),
      // For sandbox-free sessions there is no VM. Provide a minimal stub so
      // the agent can build a system prompt and respond as a plain chat.
      sandbox:
        runtime.mode === "sandbox"
          ? {
              state: runtime.sandboxState,
              workingDirectory: runtime.workingDirectory,
              currentBranch: runtime.currentBranch,
              environmentDetails: runtime.environmentDetails,
            }
          : {
              state: {} as import("@open-agents/sandbox").SandboxState,
              workingDirectory: "/",
            },
      ...(runtime.skills.length > 0 ? { skills: runtime.skills } : {}),
    };
    sandboxState =
      runtime.mode === "sandbox" ? runtime.sandboxState : undefined;

    for (
      let step = 0;
      options.maxSteps === undefined || step < options.maxSteps;
      step++
    ) {
      let result: Awaited<ReturnType<typeof runAgentStep>>;

      try {
        result = await runAgentStep(
          modelMessages,
          originalMessagesForStep,
          assistantId,
          writable,
          workflowRunId,
          options.chatId,
          options.sessionId,
          options.userId,
          options.requestId ?? null,
          selectedModelId,
          modelId,
          inferenceRoute,
          inferenceProfileId,
          inferenceProfileName,
          inferenceProvider,
          agentOptions,
          step + 1,
        );
      } catch (error) {
        if (isStepTimingError(error)) {
          stepTimings.push(error.stepTiming);
        }
        throw error;
      }

      stepTimings.push(result.stepTiming);
      pendingAssistantResponse =
        result.responseMessage ?? pendingAssistantResponse;
      shouldRefreshCachedDiff =
        shouldRefreshCachedDiff ||
        shouldRefreshDiffCacheForParts(pendingAssistantResponse.parts);
      originalMessagesForStep = [pendingAssistantResponse];
      modelMessages.push(...result.responseMessages);
      wasAborted = wasAborted || result.stepWasAborted;
      finalFinishReason = result.finishReason;

      if (result.stepUsage) {
        totalUsage = totalUsage
          ? addLanguageModelUsage(totalUsage, result.stepUsage)
          : result.stepUsage;
      }

      // FIX 1: Record a progress event for each completed agent step.
      // Best-effort; never throws. runAgentStep's signature is unchanged.
      if (goalLedgerId) {
        try {
          await appendGoalLedgerEvent({
            goalId: goalLedgerId,
            userId: options.userId,
            eventType: "progress",
            summary: `Step ${step + 1} completed`,
            payload: {
              stepNumber: step + 1,
              finishReason: result.finishReason,
            },
          });
        } catch (progressErr: unknown) {
          console.error(
            "[chat] goal-ledger progress event failed (non-fatal):",
            progressErr,
          );
        }
      }

      const shouldContinue =
        result.finishReason === "tool-calls" &&
        !shouldPauseForToolInteraction(
          result.responseMessage?.parts ?? pendingAssistantResponse.parts,
        );

      if (!shouldContinue) {
        break;
      }

      if (options.maxSteps !== undefined && step + 1 >= options.maxSteps) {
        exhaustedMaxSteps = true;
        break;
      }
    }

    if (sandboxState) {
      await refreshLifecycleActivity(options.sessionId);
    }

    if (totalUsage) {
      pendingAssistantResponse = {
        ...pendingAssistantResponse,
        metadata: {
          ...pendingAssistantResponse.metadata,
          totalMessageUsage: totalUsage,
        },
      };
    }

    // Persist completed model output before post-finish work so it is not lost
    // if later automation fails. Sandbox state can persist in parallel.
    await Promise.all([
      persistAssistantMessage(options.chatId, pendingAssistantResponse),
      ...(sandboxState
        ? [persistSandboxState(options.sessionId, sandboxState)]
        : []),
    ]);

    const finishedNaturally =
      !wasAborted &&
      finalFinishReason !== undefined &&
      finalFinishReason !== "tool-calls";
    const commitPartId = `${assistantId}:commit`;
    const prPartId = `${assistantId}:pr`;
    const repoOwner = runtime.repoOwner;
    const repoName = runtime.repoName;
    let didUpdateGitData = false;

    let autoCommitResult: Awaited<ReturnType<typeof runAutoCommitStep>> | null =
      null;

    const canAutoCommit =
      finishedNaturally &&
      (options.autoCommitEnabled ?? modelRuntime.autoCommitEnabled) &&
      sandboxState != null &&
      repoOwner != null &&
      repoName != null;

    if (canAutoCommit) {
      // sandboxState is guaranteed non-null by the canAutoCommit guard above.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const resolvedSandboxState = sandboxState!;
      const hasAutoCommitChanges = await hasAutoCommitChangesStep({
        sandboxState: resolvedSandboxState,
      });

      if (hasAutoCommitChanges) {
        const pendingCommitPart: WebAgentCommitDataPart = {
          type: "data-commit",
          id: commitPartId,
          data: { status: "pending" },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          pendingCommitPart,
        );
        await sendDataPart(writable, pendingCommitPart);
        await emitSessionEvent({
          sessionId: options.sessionId,
          chatId: options.chatId,
          userId: options.userId,
          source: "github",
          actorType: "workflow",
          eventName: "workflow.auto_commit.started",
          status: "started",
          summary: "Auto-commit started.",
          requestId: options.requestId ?? null,
          workflowRunId,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileRunId,
          payload: { repoOwner, repoName },
        });
        autoCommitResult = await runAutoCommitStep({
          userId: options.userId,
          sessionId: options.sessionId,
          sessionTitle: runtime.sessionTitle,
          repoOwner,
          repoName,
          sandboxState: resolvedSandboxState,
        });

        const resolvedCommitPart: WebAgentCommitDataPart = {
          type: "data-commit",
          id: commitPartId,
          data: buildCommitData(autoCommitResult, repoOwner, repoName),
        };
        await emitSessionEvent({
          sessionId: options.sessionId,
          chatId: options.chatId,
          userId: options.userId,
          source: "github",
          actorType: "workflow",
          eventName: autoCommitResult.error
            ? "workflow.auto_commit.failed"
            : autoCommitResult.committed
              ? "workflow.auto_commit.succeeded"
              : "workflow.auto_commit.skipped",
          status: autoCommitResult.error
            ? "failed"
            : autoCommitResult.committed
              ? "succeeded"
              : "skipped",
          summary: autoCommitResult.error
            ? `Auto-commit failed: ${autoCommitResult.error}`
            : autoCommitResult.committed
              ? "Auto-commit completed."
              : "Auto-commit found no changes to commit.",
          requestId: options.requestId ?? null,
          workflowRunId,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileRunId,
          payload: {
            committed: autoCommitResult.committed,
            pushed: autoCommitResult.pushed,
            commitSha: autoCommitResult.commitSha,
          },
        });
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          resolvedCommitPart,
        );
        await sendDataPart(writable, resolvedCommitPart);
        didUpdateGitData = true;
        shouldRefreshCachedDiff = true;
      } else {
        autoCommitResult = {
          committed: false,
          pushed: false,
        };
      }
    }

    const canAutoCreatePr =
      autoCommitResult != null &&
      !autoCommitResult.error &&
      (autoCommitResult.pushed || !autoCommitResult.committed);

    if (
      canAutoCommit &&
      (options.autoCreatePrEnabled ?? modelRuntime.autoCreatePrEnabled)
    ) {
      if (canAutoCreatePr) {
        const pendingPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: { status: "pending" },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          pendingPrPart,
        );
        await sendDataPart(writable, pendingPrPart);
        await emitSessionEvent({
          sessionId: options.sessionId,
          chatId: options.chatId,
          userId: options.userId,
          source: "github",
          actorType: "workflow",
          eventName: "workflow.auto_pr.started",
          status: "started",
          summary: "Auto-PR creation started.",
          requestId: options.requestId ?? null,
          workflowRunId,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileRunId,
          payload: { repoOwner, repoName },
        });
        const autoPrResult = await runAutoCreatePrStep({
          userId: options.userId,
          sessionId: options.sessionId,
          sessionTitle: runtime.sessionTitle,
          repoOwner,
          repoName,
          // sandboxState is guaranteed non-null by the canAutoCommit guard.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          sandboxState: sandboxState!,
        });

        const resolvedPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: buildPrData(autoPrResult),
        };
        await emitSessionEvent({
          sessionId: options.sessionId,
          chatId: options.chatId,
          userId: options.userId,
          source: "github",
          actorType: "workflow",
          eventName: autoPrResult.error
            ? "workflow.auto_pr.failed"
            : autoPrResult.skipped
              ? "workflow.auto_pr.skipped"
              : "workflow.auto_pr.succeeded",
          status: autoPrResult.error
            ? "failed"
            : autoPrResult.skipped
              ? "skipped"
              : "succeeded",
          summary: autoPrResult.error
            ? `Auto-PR failed: ${autoPrResult.error}`
            : autoPrResult.skipped
              ? `Auto-PR skipped: ${autoPrResult.skipReason ?? "not needed"}`
              : "Auto-PR completed.",
          requestId: options.requestId ?? null,
          workflowRunId,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileRunId,
          payload: {
            created: autoPrResult.created,
            syncedExisting: autoPrResult.syncedExisting,
            prNumber: autoPrResult.prNumber,
            prUrl: autoPrResult.prUrl,
          },
        });
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          resolvedPrPart,
        );
        await sendDataPart(writable, resolvedPrPart);
        didUpdateGitData = true;
        shouldRefreshCachedDiff = true;
      } else {
        const skippedPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: {
            status: "skipped",
            skipReason:
              autoCommitResult?.error ??
              "Auto-commit did not leave origin in sync with HEAD",
          },
        };
        await emitSessionEvent({
          sessionId: options.sessionId,
          chatId: options.chatId,
          userId: options.userId,
          source: "github",
          actorType: "workflow",
          eventName: "workflow.auto_pr.skipped",
          status: "skipped",
          summary:
            autoCommitResult?.error ??
            "Auto-PR skipped because auto-commit did not leave origin in sync with HEAD.",
          requestId: options.requestId ?? null,
          workflowRunId,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileRunId,
        });
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          skippedPrPart,
        );
        await sendDataPart(writable, skippedPrPart);
        didUpdateGitData = true;
      }
    }

    if (didUpdateGitData) {
      await persistAssistantMessage(options.chatId, pendingAssistantResponse);
    }

    workflowStatus = wasAborted
      ? "aborted"
      : exhaustedMaxSteps
        ? "failed"
        : "completed";

    if (
      runtime.mode === "sandbox" &&
      runtime.runtimeMode === "managed_runtime" &&
      runtime.managedRuntime
    ) {
      const runtimeProofArtifacts = await collectRuntimeProofArtifacts({
        sessionId: options.sessionId,
        chatId: options.chatId,
      });
      const runtimeProofPart: WebAgentRuntimeProofDataPart = {
        type: "data-runtime-proof",
        id: `${assistantId}:runtime-proof`,
        data: buildRuntimeProofData({
          workflowRunId,
          workflowStatus,
          sandboxName: runtimeSandboxName,
          managedRuntime: runtime.managedRuntime,
          assistantParts: pendingAssistantResponse.parts,
          artifacts: runtimeProofArtifacts,
        }),
      };
      pendingAssistantResponse = upsertAssistantDataPart(
        pendingAssistantResponse,
        runtimeProofPart,
      );
      await sendDataPart(writable, runtimeProofPart);
      await persistAssistantMessage(options.chatId, pendingAssistantResponse);
    }

    await Promise.all([
      clearActiveStream(options.chatId, workflowRunId),
      sendFinish(writable).then(() => closeStream(writable)),
      ...(sandboxState && shouldRefreshCachedDiff
        ? [refreshDiffCache(options.sessionId, sandboxState)]
        : []),
    ]);
    streamClosed = true;
  } catch (error) {
    workflowStatus = wasAborted ? "aborted" : "failed";
    caughtError = error;

    if (pendingAssistantResponse.parts.length === 0 && !streamClosed) {
      const errorText = getUserFacingWorkflowErrorMessage(error);
      pendingAssistantResponse = {
        ...pendingAssistantResponse,
        parts: [{ type: "text", text: errorText }],
      };
      await sendTextMessage(writable, "setup-error", errorText);
      await persistAssistantMessage(options.chatId, pendingAssistantResponse);
    }
  } finally {
    try {
      // On unexpected errors, still clear the active stream and close
      // so the chat is never permanently marked as streaming.
      if (!streamClosed) {
        await Promise.all([
          clearActiveStream(options.chatId, workflowRunId),
          sendFinish(writable).then(() => closeStream(writable)),
        ]);
      }
    } finally {
      const runFinishedAt = new Date();
      await recordWorkflowUsage(
        options.userId,
        modelId,
        totalUsage,
        pendingAssistantResponse,
        previousResponseMessage,
        {
          workflowRunId,
          chatId: options.chatId,
          sessionId: options.sessionId,
          requestId: options.requestId ?? null,
          runtimeMode,
          sandboxName: runtimeSandboxName,
          managedRuntimeProfileId,
          managedRuntimeProfileVersion,
          managedRuntimeProfileRunId,
          inferenceRoute,
          inferenceProfileId,
          errorMessage: caughtError ? getErrorMessage(caughtError) : null,
          status: workflowStatus,
          startedAt: runStartedAt.toISOString(),
          finishedAt: runFinishedAt.toISOString(),
          totalDurationMs: runFinishedAt.getTime() - runStartedAt.getTime(),
          stepTimings,
        },
      );
      await emitSessionEvent({
        sessionId: options.sessionId,
        chatId: options.chatId,
        userId: options.userId,
        source: "workflow",
        actorType: "workflow",
        eventName:
          workflowStatus === "completed"
            ? "workflow.completed"
            : workflowStatus === "aborted"
              ? "workflow.aborted"
              : "workflow.failed",
        status:
          workflowStatus === "completed"
            ? "succeeded"
            : workflowStatus === "aborted"
              ? "skipped"
              : "failed",
        summary:
          workflowStatus === "completed"
            ? "Agent workflow completed."
            : workflowStatus === "aborted"
              ? "Agent workflow was stopped."
              : `Agent workflow failed: ${caughtError ? getErrorMessage(caughtError) : "unknown error"}`,
        requestId: options.requestId ?? null,
        workflowRunId,
        sandboxName: runtimeSandboxName,
        managedRuntimeProfileRunId,
        payload: {
          runtimeMode,
          modelId,
          selectedModelId,
          inferenceRoute,
          inferenceProfileId,
          inferenceProfileName,
          inferenceProvider,
          stepCount: stepTimings.length,
          totalDurationMs: runFinishedAt.getTime() - runStartedAt.getTime(),
          finishReason: finalFinishReason ?? null,
        },
      });

      // Record goal ledger final event + close. The call site is guarded so
      // that any unexpected wrapper failure cannot crash the workflow.
      if (goalLedgerId) {
        try {
          // FIX 4: Use the sanitized user-facing error message for the failed
          // summary so the ledger does not store raw internal error text.
          const finalSummary =
            workflowStatus === "completed"
              ? "Workflow completed successfully."
              : workflowStatus === "aborted"
                ? "Workflow was aborted."
                : `Workflow failed: ${caughtError ? getUserFacingWorkflowErrorMessage(caughtError) : "unknown error"}`;
          // Map workflow status to terminal goal status.
          // workflowStatus values: "completed" | "aborted" | "failed"
          // TERMINAL_GOAL_STATUSES values: "complete" | "canceled" | "failed" | "archived"
          const terminalStatus =
            workflowStatus === "completed"
              ? "complete"
              : workflowStatus === "aborted"
                ? "canceled"
                : "failed";
          await appendGoalLedgerEvent({
            goalId: goalLedgerId,
            userId: options.userId,
            eventType: "final",
            summary: finalSummary,
          });

          // Issue #38: validate before closing as "complete". requireEvidence
          // is false today (proof levels not yet linked to goals), so this is
          // a no-op in production. The blocked branch is tested via forced mock.
          const validation = await validateGoalForClose({
            goalId: goalLedgerId,
            userId: options.userId,
            terminalStatus,
          });

          if (!validation.ok) {
            // Validation failed — record a blocked event instead of closing.
            // This branch is currently unreachable in production (requireEvidence=false)
            // but is exercised by the integration test via a forced mock.
            console.error(
              `[chat] goal-ledger validation failed for goal "${goalLedgerId}": ${validation.reason ?? "validation_rule_failed"}`,
            );
            await appendGoalLedgerEvent({
              goalId: goalLedgerId,
              userId: options.userId,
              eventType: "blocked",
              summary: `Goal close blocked by validation: ${validation.reason ?? "validation_rule_failed"}`,
              payload: { reason: validation.reason },
            });
          } else {
            await closeGoalLedger({
              goalId: goalLedgerId,
              terminalStatus,
            });
          }
        } catch (err: unknown) {
          console.error("[chat] goal-ledger close failed (non-fatal):", err);
        }
      }
    }
  }

  if (caughtError) {
    throw caughtError;
  }
}

async function resolveStepInferenceProfileModel(params: {
  userId: string;
  inferenceProfileId: string;
  selection: AgentModelSelection;
}): Promise<AgentModelSelection> {
  const { resolveInferenceProfileModelSelection } =
    await import("@/lib/inference/profile-resolution");
  return resolveInferenceProfileModelSelection(params);
}

const runAgentStep = async (
  messages: ModelMessage[],
  originalMessages: WebAgentUIMessage[],
  messageId: string,
  writable: Writable,
  workflowRunId: string,
  chatId: string,
  sessionId: string,
  userId: string,
  requestId: string | null,
  selectedModelId: string,
  modelId: string,
  inferenceRoute: InferenceRoute,
  inferenceProfileId: string | null,
  inferenceProfileName: string | null,
  inferenceProvider: string | null,
  agentOptions: OpenAgentCallOptions,
  stepNumber: number,
) => {
  "use step";

  const stepStartedAt = new Date();
  const { webAgent } = await import("@/app/config");
  const { resolveComposioToolsForChat } =
    await import("@/lib/composio/session");
  const { emitSessionEvent } = await import("@/lib/observability/events");

  const abortController = new AbortController();
  const stopMonitor = startStopMonitor(workflowRunId, abortController);
  const stepSandboxName = agentOptions.sandbox.state.sandboxName ?? null;
  const stepManagedRuntimeProfileRunId =
    agentOptions.managedRuntime?.profileRunId ?? null;
  let lastStreamError: unknown;

  try {
    const stepAgentOptions =
      inferenceProfileId && agentOptions.model
        ? {
            ...agentOptions,
            model: await resolveStepInferenceProfileModel({
              userId,
              inferenceProfileId,
              selection:
                typeof agentOptions.model === "string"
                  ? ({
                      id: agentOptions.model,
                    } as AgentModelSelection)
                  : (agentOptions.model as AgentModelSelection),
            }),
          }
        : agentOptions;

    await emitSessionEvent({
      sessionId,
      chatId,
      userId,
      source: "workflow",
      actorType: "coordinator",
      eventName: "workflow.step.started",
      status: "started",
      summary: `Agent step ${stepNumber} started.`,
      requestId,
      workflowRunId,
      sandboxName: stepSandboxName,
      managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
      payload: {
        stepNumber,
        runtimeMode: agentOptions.runtimeMode ?? "classic",
        modelId,
        selectedModelId,
        inferenceProfileId,
      },
    });
    let responseMessage: WebAgentUIMessage | undefined;
    let lastStepUsage: LanguageModelUsage | undefined;
    let lastStepCost: number | undefined;
    const lastOriginalMessage = originalMessages.at(-1);
    const existingStepFinishReasons: WebAgentStepFinishMetadata[] =
      lastOriginalMessage?.role === "assistant"
        ? [...(lastOriginalMessage.metadata?.stepFinishReasons ?? [])]
        : [];
    const existingTotalMessageUsage =
      lastOriginalMessage?.role === "assistant"
        ? lastOriginalMessage.metadata?.totalMessageUsage
        : undefined;
    const existingTotalMessageCost =
      lastOriginalMessage?.role === "assistant"
        ? lastOriginalMessage.metadata?.totalMessageCost
        : undefined;
    let stepFinishReasons = existingStepFinishReasons;
    let totalMessageUsage = existingTotalMessageUsage;
    let totalMessageCost = existingTotalMessageCost;

    let composioTools: ToolSet | undefined;
    try {
      const composioResult = await resolveComposioToolsForChat({
        userId,
        chatId,
        agentKey: "main",
        runtimeMode: agentOptions.runtimeMode ?? "classic",
      });

      if (composioResult.status === "ready") {
        composioTools = composioResult.tools;
        await emitSessionEvent({
          sessionId,
          chatId,
          userId,
          source: "workflow",
          actorType: "coordinator",
          eventName: "composio.profile.selected",
          status: "succeeded",
          summary: composioResult.profile
            ? `Using Composio profile: ${composioResult.profile.name}.`
            : `Using Composio direct toolkit list.`,
          requestId,
          workflowRunId,
          sandboxName: stepSandboxName,
          managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
          payload: {
            stepNumber,
            profileId: composioResult.profile?.id ?? null,
            profileName: composioResult.profile?.name ?? null,
            toolkitSlugs: composioResult.profile?.toolkitSlugs ?? null,
            configHash: composioResult.configHash,
            composioSessionId: composioResult.composioSessionId,
            toolCount: Object.keys(composioResult.tools).length,
          },
        });
        await emitSessionEvent({
          sessionId,
          chatId,
          userId,
          source: "workflow",
          actorType: "coordinator",
          eventName: composioResult.reusedSession
            ? "composio.session.reused"
            : "composio.session.created",
          status: "succeeded",
          summary: composioResult.reusedSession
            ? "Reused Composio tool session."
            : "Created Composio tool session.",
          requestId,
          workflowRunId,
          sandboxName: stepSandboxName,
          managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
          payload: {
            stepNumber,
            profileId: composioResult.profile?.id ?? null,
            configHash: composioResult.configHash,
            composioSessionId: composioResult.composioSessionId,
          },
        });
      }
    } catch (error) {
      await emitSessionEvent({
        sessionId,
        chatId,
        userId,
        source: "workflow",
        actorType: "coordinator",
        eventName: "composio.session.failed",
        status: "failed",
        summary: getComposioUserFacingError(error),
        requestId,
        workflowRunId,
        sandboxName: stepSandboxName,
        managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
        payload: {
          stepNumber,
          errorName: error instanceof Error ? error.name : "Error",
        },
      });
      throw error;
    }

    const result = await webAgent.stream({
      messages,
      options: stepAgentOptions,
      ...(composioTools ? { tools: composioTools } : {}),
      abortSignal: abortController.signal,
    });

    for await (const part of result.toUIMessageStream<WebAgentUIMessage>({
      originalMessages,
      generateMessageId: () => messageId,
      sendStart: false,
      sendFinish: false,
      onError: (error) => {
        lastStreamError = error;
        console.error(error);
        return getErrorMessage(error);
      },
      messageMetadata: ({ part: streamPart }) => {
        if (streamPart.type === "finish-step") {
          lastStepUsage = streamPart.usage;
          if (streamPart.usage) {
            totalMessageUsage = totalMessageUsage
              ? addLanguageModelUsage(totalMessageUsage, streamPart.usage)
              : streamPart.usage;
          }
          const stepCost = extractGatewayCost(streamPart.providerMetadata);
          if (stepCost !== undefined) {
            lastStepCost = stepCost;
            totalMessageCost = (totalMessageCost ?? 0) + stepCost;
          }
          stepFinishReasons = [
            ...stepFinishReasons,
            {
              finishReason: streamPart.finishReason,
              rawFinishReason: streamPart.rawFinishReason,
            },
          ];
          return {
            selectedModelId,
            modelId,
            inferenceRoute,
            ...(inferenceProfileId ? { inferenceProfileId } : {}),
            ...(inferenceProfileName ? { inferenceProfileName } : {}),
            ...(inferenceProvider ? { inferenceProvider } : {}),
            lastStepUsage,
            totalMessageUsage,
            lastStepCost,
            totalMessageCost,
            lastStepFinishReason: streamPart.finishReason,
            lastStepRawFinishReason: streamPart.rawFinishReason,
            stepFinishReasons,
          } satisfies WebAgentMessageMetadata;
        }
        return undefined;
      },
      onFinish: ({ responseMessage: finishedResponseMessage }) => {
        responseMessage = finishedResponseMessage;
      },
    })) {
      const writer = writable.getWriter();
      await writer.write(part);
      writer.releaseLock();
    }

    if (responseMessage == null) {
      throw new Error("Agent stream finished without a response message");
    }

    responseMessage = {
      ...responseMessage,
      metadata: withModelMetadata(
        responseMessage.metadata,
        selectedModelId,
        modelId,
        {
          inferenceRoute,
          inferenceProfileId,
          inferenceProfileName,
          inferenceProvider,
        },
      ),
    };

    const [stepUsage, finishReason, rawFinishReason, response, steps] =
      await Promise.all([
        result.totalUsage,
        result.finishReason,
        result.rawFinishReason,
        result.response,
        result.steps,
      ]);

    if (stepUsage) {
      responseMessage = {
        ...responseMessage,
        metadata: {
          ...responseMessage.metadata,
          totalMessageUsage: existingTotalMessageUsage
            ? addLanguageModelUsage(existingTotalMessageUsage, stepUsage)
            : stepUsage,
        },
      };
    }

    const stepsCost = steps.reduce<number | undefined>((sum, step) => {
      const cost = extractGatewayCost(step.providerMetadata);
      if (cost === undefined) {
        return sum;
      }
      return (sum ?? 0) + cost;
    }, undefined);

    if (stepsCost !== undefined) {
      const carriedCost = (existingTotalMessageCost ?? 0) + stepsCost;
      responseMessage = {
        ...responseMessage,
        metadata: {
          ...responseMessage.metadata,
          lastStepCost,
          totalMessageCost: carriedCost,
        },
      };
    }

    if (finishReason === "other") {
      const stepDiagnostics = steps.map((step) => ({
        stepNumber: step.stepNumber,
        model: step.model,
        finishReason: step.finishReason,
        rawFinishReason: step.rawFinishReason,
        usage: step.usage,
        warnings: step.warnings,
        contentTypes: step.content.map((contentPart) => contentPart.type),
        toolCalls: step.toolCalls.map((toolCall) =>
          compactRecord({
            toolName: toolCall.toolName,
            dynamic: toolCall.dynamic,
            invalid: "invalid" in toolCall ? toolCall.invalid : undefined,
            providerExecuted: toolCall.providerExecuted,
          }),
        ),
        toolResults: step.toolResults.map((toolResult) =>
          compactRecord({
            toolName: toolResult.toolName,
            dynamic: toolResult.dynamic,
            preliminary: toolResult.preliminary,
            providerExecuted: toolResult.providerExecuted,
          }),
        ),
        request: compactRecord({
          body: summarizeRequestBody(step.request.body),
        }),
        response: compactRecord({
          id: step.response.id,
          modelId: step.response.modelId,
          timestamp: step.response.timestamp.toISOString(),
          headers: step.response.headers,
          body: summarizeResponseBody(step.response.body),
          messageCount: step.response.messages.length,
        }),
        providerMetadata: step.providerMetadata,
      }));

      const debugPayload = stringifyDebugPayload({
        workflowRunId,
        chatId,
        sessionId,
        messageId,
        selectedModelId,
        modelId,
        finishReason,
        rawFinishReason,
        stepUsage,
        response,
        responseMessage,
        stepDiagnostics,
      });

      console.warn(
        `[workflow] Agent step finished with reason 'other':\n${debugPayload}`,
      );
    }

    const stepFinishedAt = new Date();
    await emitSessionEvent({
      sessionId,
      chatId,
      userId,
      source: "workflow",
      actorType: "coordinator",
      eventName: "workflow.step.completed",
      status: "succeeded",
      summary: `Agent step ${stepNumber} completed with ${finishReason}.`,
      requestId,
      workflowRunId,
      sandboxName: stepSandboxName,
      managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
      payload: {
        stepNumber,
        runtimeMode: agentOptions.runtimeMode ?? "classic",
        inferenceRoute,
        inferenceProfileId,
        finishReason,
        rawFinishReason: rawFinishReason ?? null,
        durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
        modelStepCount: steps.length,
        toolCallCount: steps.reduce(
          (count, step) => count + step.toolCalls.length,
          0,
        ),
        usage: stepUsage ?? null,
        cost: stepsCost ?? null,
      },
    });

    return {
      responseMessage,
      responseMessages: response.messages,
      finishReason,
      rawFinishReason,
      stepUsage,
      stepCost: stepsCost,
      stepWasAborted: false,
      stepTiming: buildStepTiming(
        stepNumber,
        stepStartedAt,
        stepFinishedAt,
        finishReason,
        rawFinishReason,
      ),
    };
  } catch (error) {
    const stepFinishedAt = new Date();

    if (isAbortError(error)) {
      const abortedFinishReason: FinishReason = "stop";
      await emitSessionEvent({
        sessionId,
        chatId,
        userId,
        source: "workflow",
        actorType: "coordinator",
        eventName: "workflow.step.aborted",
        status: "skipped",
        summary: `Agent step ${stepNumber} was stopped.`,
        requestId,
        workflowRunId,
        sandboxName: stepSandboxName,
        managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
        payload: {
          stepNumber,
          durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
        },
      });
      return {
        responseMessage: undefined,
        responseMessages: [],
        finishReason: abortedFinishReason,
        rawFinishReason: undefined,
        stepUsage: undefined,
        stepCost: undefined,
        stepWasAborted: true,
        stepTiming: buildStepTiming(
          stepNumber,
          stepStartedAt,
          stepFinishedAt,
          abortedFinishReason,
        ),
      };
    }

    const baseError = error instanceof Error ? error : new Error(String(error));
    const errorWithStepTiming =
      lastStreamError && baseError.message.includes("No output generated")
        ? new Error(
            `${baseError.message}\n\nProvider error: ${getErrorMessage(lastStreamError)}`,
          )
        : baseError;
    await emitSessionEvent({
      sessionId,
      chatId,
      userId,
      source: "workflow",
      actorType: "coordinator",
      eventName: "workflow.step.failed",
      status: "failed",
      summary: `Agent step ${stepNumber} failed: ${getErrorMessage(errorWithStepTiming)}`,
      requestId,
      workflowRunId,
      sandboxName: stepSandboxName,
      managedRuntimeProfileRunId: stepManagedRuntimeProfileRunId,
      payload: {
        stepNumber,
        durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
        errorName: errorWithStepTiming.name,
      },
    });
    Object.assign(errorWithStepTiming, {
      stepTiming: buildStepTiming(
        stepNumber,
        stepStartedAt,
        stepFinishedAt,
        "error",
        errorWithStepTiming.name,
      ),
    });
    throw errorWithStepTiming;
  } finally {
    stopMonitor.stop();
    await stopMonitor.done;
  }
};

function startStopMonitor(runId: string, abortController: AbortController) {
  let shouldStop = false;

  const done = (async () => {
    const run = getRun(runId);

    while (!shouldStop && !abortController.signal.aborted) {
      let runStatus:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled";

      try {
        runStatus = await run.status;
      } catch {
        await delay(150);
        continue;
      }

      if (runStatus === "cancelled") {
        abortController.abort();
        return;
      }

      await delay(150);
    }
  })();

  return {
    stop() {
      shouldStop = true;
    },
    done,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function sendTextMessage(writable: Writable, id: string, text: string) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "text-start", id });
    await writer.write({ type: "text-delta", id, delta: text });
    await writer.write({ type: "text-end", id });
  } finally {
    writer.releaseLock();
  }
}
