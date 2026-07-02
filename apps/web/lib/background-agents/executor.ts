import "server-only";

import {
  defaultModelLabel,
  gateway,
  openAgent,
  type AgentModelSelection,
  type OpenAgentCallOptions,
  sanitizeUnattendedToolCalls,
} from "@open-agents/agent";
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-agents/sandbox";
import type { ModelMessage } from "ai";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
  type ScopedInstallationToken,
} from "@/lib/github/app";
import { getGitHubUserProfile } from "@/lib/github/users";
import type {
  BackgroundAgentGithubActions,
  NewBackgroundAgentOutput,
} from "@/lib/db/schema";
import {
  defaultBackgroundAgentGithubActions,
  defaultBackgroundAgentWriteScope,
} from "@/lib/db/schema";
import {
  getBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
  recordBackgroundAgentEvent,
  updateBackgroundAgentRunStatus,
} from "./store";
import { resolveComposioToolsForBgRun } from "./composio-tools";
import {
  resolveGitHubActionTools,
  type GitHubActionToggles,
  type BackgroundAgentWriteScope as GitHubToolsWriteScope,
} from "./github-action-tools";
import { mergeExtraTools } from "@/app/workflows/merge-extra-tools";
import { buildRunSummary } from "./run-summary";
import {
  persistRunSummary,
  recordSummaryFailedEvent,
} from "./run-summary-persist";
import { buildBackgroundCommandObservation } from "./runtime-observability";
import {
  buildBackgroundAgentRunbookPrompt,
  buildBackgroundBranchName,
} from "./ready-pr";
import type { NormalizedBackgroundTriggerEvent } from "./types";
import { isLearningsAgent } from "@/lib/learnings/builtin-agent";
import { runLearningsExtraction } from "@/lib/learnings/runner";
import { createDbLearningsStore } from "@/lib/learnings/store";
import { generateText, Output } from "ai";
import { recordUsage } from "@/lib/db/usage";
import { extractedLearningCandidateSchema } from "@/lib/learnings/types";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";
import { resolveInferenceProfileModelSelection } from "@/lib/inference/profile-resolution";

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_TIMEOUT_MS = 600_000;
// Action tools (github_push, github_open_pull_request, ...) now consume
// steps alongside file/bash tools, so the old 8-step budget starved agents
// that both edit files and open a PR. Raised to 16 to give action-heavy
// runs enough room without materially increasing runaway-loop risk (the
// unattended sanitizer + timeout still bound worst case).
const DEFAULT_AGENT_MAX_STEPS = 16;

/**
 * Maps each native GitHub action tool name to the `backgroundAgentOutputs.kind`
 * value recorded for a successful call (#745/#746).
 */
const OUTPUT_KIND_BY_ACTION: Record<
  keyof BackgroundAgentGithubActions,
  NewBackgroundAgentOutput["kind"]
> = {
  open_pull_request: "ready_pr",
  comment_on_pr_or_issue: "pr_comment",
  approve_pull_request: "pr_review",
  request_changes: "pr_review",
  merge_pull_request: "merge",
  push: "push",
  delete_branch: "branch_delete",
};

/**
 * Human-readable tool names, in the same order actions are declared on
 * BackgroundAgentGithubActions, used to steer the run prompt.
 */
const GITHUB_ACTION_TOOL_NAMES: Record<
  keyof BackgroundAgentGithubActions,
  string
> = {
  open_pull_request: "github_open_pull_request",
  comment_on_pr_or_issue: "github_comment_on_pr_or_issue",
  approve_pull_request: "github_approve_pull_request",
  request_changes: "github_request_changes",
  merge_pull_request: "github_merge_pull_request",
  push: "github_push",
  delete_branch: "github_delete_branch",
};

/**
 * Converts the stored snake_case `githubActions` toggles into the camelCase
 * `GitHubActionToggles` shape expected by resolveGitHubActionTools. Missing
 * keys default to the module-level defaults (open_pull_request +
 * comment_on_pr_or_issue enabled, everything else disabled).
 */
function toGitHubActionToggles(
  actions: BackgroundAgentGithubActions | null | undefined,
): GitHubActionToggles {
  // The whole object defaults when the agent has never set githubActions
  // (null/undefined) — an agent that explicitly sets a partial object means
  // every OMITTED action is disabled, not defaulted back in.
  const merged = actions ?? defaultBackgroundAgentGithubActions;
  return {
    openPullRequest: merged.open_pull_request ?? false,
    commentOnPrOrIssue: merged.comment_on_pr_or_issue ?? false,
    approvePullRequest: merged.approve_pull_request ?? false,
    requestChanges: merged.request_changes ?? false,
    mergePullRequest: merged.merge_pull_request ?? false,
    push: merged.push ?? false,
    deleteBranch: merged.delete_branch ?? false,
  };
}

/**
 * Converts the flat `backgroundAgents.writeScope` column shape (schema.ts)
 * into the discriminated union `resolveGitHubActionTools` expects
 * (github-action-tools.ts). Both describe the same three modes; only the
 * `repos` field's presence differs by mode.
 */
function toGitHubToolsWriteScope(
  scope: import("@/lib/db/schema").BackgroundAgentWriteScope | null | undefined,
): GitHubToolsWriteScope {
  const resolved = scope ?? defaultBackgroundAgentWriteScope;
  if (resolved.mode === "specific_repos") {
    return { mode: "specific_repos", repos: resolved.repos ?? [] };
  }
  return { mode: resolved.mode };
}

function hasAnyWriteAction(toggles: GitHubActionToggles): boolean {
  return (
    toggles.push ||
    toggles.mergePullRequest ||
    toggles.deleteBranch ||
    toggles.openPullRequest ||
    toggles.approvePullRequest ||
    toggles.requestChanges
  );
}

function enabledGithubActionToolNames(
  actions: BackgroundAgentGithubActions | null | undefined,
): string[] {
  const toggles = toGitHubActionToggles(actions);
  const names: string[] = [];
  if (toggles.openPullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.open_pull_request);
  if (toggles.commentOnPrOrIssue)
    names.push(GITHUB_ACTION_TOOL_NAMES.comment_on_pr_or_issue);
  if (toggles.approvePullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.approve_pull_request);
  if (toggles.requestChanges)
    names.push(GITHUB_ACTION_TOOL_NAMES.request_changes);
  if (toggles.mergePullRequest)
    names.push(GITHUB_ACTION_TOOL_NAMES.merge_pull_request);
  if (toggles.push) names.push(GITHUB_ACTION_TOOL_NAMES.push);
  if (toggles.deleteBranch) names.push(GITHUB_ACTION_TOOL_NAMES.delete_branch);
  return names;
}

function buildOutputKindByAction(): Record<
  string,
  NewBackgroundAgentOutput["kind"]
> {
  return {
    open_pull_request: OUTPUT_KIND_BY_ACTION.open_pull_request,
    comment_on_pr_or_issue: OUTPUT_KIND_BY_ACTION.comment_on_pr_or_issue,
    approve_pull_request: OUTPUT_KIND_BY_ACTION.approve_pull_request,
    request_changes: OUTPUT_KIND_BY_ACTION.request_changes,
    merge_pull_request: OUTPUT_KIND_BY_ACTION.merge_pull_request,
    push: OUTPUT_KIND_BY_ACTION.push,
    delete_branch: OUTPUT_KIND_BY_ACTION.delete_branch,
  };
}

function buildSandboxName(runId: string) {
  return `background_agent_${runId}`;
}

async function getGitUser(userId: string) {
  const profile = await getGitHubUserProfile(userId);
  const githubNoreplyEmail =
    profile?.externalUserId && profile.username
      ? `${profile.externalUserId}+${profile.username}@users.noreply.github.com`
      : undefined;

  return {
    name: profile?.username ?? "Open Agents",
    email: githubNoreplyEmail ?? `${userId}@users.noreply.github.com`,
  };
}

async function recordFailure(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName?: string | null;
  errorKind: string;
  summary: string;
}) {
  await updateBackgroundAgentRunStatus({
    runId: params.runId,
    status: "failed",
    workflowRunId: params.workflowRunId,
    sandboxName: params.sandboxName ?? null,
    errorKind: params.errorKind,
    errorMessage: params.summary,
  });
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.run.failed",
    status: "failed",
    level: "warn",
    summary: params.summary,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName ?? null,
    errorKind: params.errorKind,
  });

  // Summary generation must never change the run status.
  try {
    await buildAndPersistRunSummary({
      runId: params.runId,
      agentId: params.agentId,
      userId: params.userId,
    });
  } catch (summaryError) {
    try {
      await recordSummaryFailedEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        error: summaryError,
      });
    } catch {
      // Best-effort; do not re-throw.
    }
  }
}

/**
 * Builds and persists a run summary at a terminal path.
 * MUST be wrapped in try/catch by the caller — summary failure must NOT
 * affect the run's terminal status.
 */
async function buildAndPersistRunSummary(params: {
  runId: string;
  agentId: string | null;
  userId: string;
}) {
  const [freshRun, events, outputs] = await Promise.all([
    getBackgroundAgentRunWithAgent(params.runId),
    listBackgroundAgentEvents(params.runId),
    listBackgroundAgentOutputs(params.runId),
  ]);

  if (!freshRun) {
    return;
  }

  const summary = buildRunSummary({
    run: freshRun.run,
    events,
    outputs,
  });

  await persistRunSummary({ runId: params.runId, summary });
}

async function execObservedCommand(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  eventName: string;
  command: string;
  timeoutMs?: number;
}) {
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: `${params.eventName}.started`,
    status: "running",
    summary: `Running ${params.command}`,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      command: params.command,
      timeoutMs: params.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    },
  });

  const startedAt = new Date();
  const result = await params.sandbox.exec(
    params.command,
    params.sandbox.workingDirectory,
    params.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
  );
  const finishedAt = new Date();
  const observation = buildBackgroundCommandObservation({
    command: params.command,
    startedAt,
    finishedAt,
    result,
  });

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: `${params.eventName}.completed`,
    status: result.success ? "succeeded" : "failed",
    level: result.success ? "info" : "warn",
    summary: result.success
      ? `Command passed: ${params.command}`
      : `Command failed: ${params.command}`,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    errorKind: result.success ? null : "checks_failed",
    payload: observation,
  });

  return result;
}

function getSandboxState(sandbox: Sandbox): SandboxState {
  const state = sandbox.getState?.();
  if (!state || typeof state !== "object") {
    throw new Error("Background sandbox does not expose resumable state.");
  }
  return state as SandboxState;
}

/**
 * Resolves the agent's explicit model selection (agent.modelId) into an
 * OpenAgentCallOptions["model"] value. Returns `undefined` when the agent
 * has no explicit selection — the caller falls back to the default model.
 *
 * Never silently falls back on a resolution failure: the caller is
 * expected to fail the run with errorKind 'model_resolution_failed' when
 * this throws, because the user explicitly chose this model.
 */
async function resolveBackgroundAgentModel(params: {
  userId: string;
  modelId: string | null;
}): Promise<AgentModelSelection | undefined> {
  if (!params.modelId) {
    return undefined;
  }

  const parsed = parseModelOptionSelection(params.modelId);
  const baseSelection: AgentModelSelection = {
    id: parsed.modelId as AgentModelSelection["id"],
  };

  if (!parsed.inferenceProfileId) {
    return baseSelection;
  }

  return resolveInferenceProfileModelSelection({
    userId: params.userId,
    inferenceProfileId: parsed.inferenceProfileId,
    selection: baseSelection,
  });
}

async function runBackgroundAgent(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  prompt: string;
  /** Merged Composio + native GitHub tools to inject into the agent loop. */
  extraTools?: import("ai").ToolSet;
  /** Pre-approved built-in tool names. null/absent = default policy. */
  allowedBuiltinToolNames?: string[] | null;
  /** Resolved model selection. undefined = inherit the agent-package default. */
  modelSelection?: AgentModelSelection;
  /** The model id recorded on usage events / the started event payload. */
  recordedModelId: string;
}) {
  let messages: ModelMessage[] = [
    {
      role: "user",
      content: params.prompt,
    },
  ];
  const options: OpenAgentCallOptions = {
    sandbox: {
      state: getSandboxState(params.sandbox),
      workingDirectory: params.sandbox.workingDirectory,
      currentBranch: params.sandbox.currentBranch,
      environmentDetails: params.sandbox.environmentDetails,
    },
    runtimeMode: "classic",
    // Unattended: no human can approve tool calls. Approval gates resolve
    // deterministically (web_fetch auto-approves; dangerous bash / sensitive
    // reads are denied via the sanitizer below) so a never-approved call cannot
    // wedge the run with a dangling tool_use.
    unattended: true,
    allowedBuiltinToolNames: params.allowedBuiltinToolNames ?? null,
    ...(params.modelSelection ? { model: params.modelSelection } : {}),
    customInstructions:
      "You are running inside an unattended background-agent workflow. Work autonomously, keep changes scoped, and finish with a concise summary.",
  };

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.agent.started",
    status: "running",
    summary: "Background agent started.",
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      maxSteps: DEFAULT_AGENT_MAX_STEPS,
      timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
      modelId: params.recordedModelId,
    },
  });

  for (let step = 1; step <= DEFAULT_AGENT_MAX_STEPS; step += 1) {
    const startedAt = Date.now();
    // Repair any approval-gated tool call the previous turn left without a
    // result before re-sending history — otherwise the provider rejects the
    // request ("Tool result is missing for tool call …") and fails the run.
    // sanitizeUnattendedToolCalls returns the SAME array reference when
    // nothing needed fixing, so a reference change means it denied at least
    // one dangling tool call — surface that as an audit event per call.
    const sanitized = sanitizeUnattendedToolCalls(messages);
    if (sanitized !== messages) {
      for (const deniedToolName of collectDeniedToolNames(
        messages,
        sanitized,
      )) {
        await recordBackgroundAgentEvent({
          runId: params.runId,
          agentId: params.agentId,
          userId: params.userId,
          eventName: "background-agent.tool.denied",
          status: "failed",
          level: "warn",
          summary: `Denied unattended tool call: ${deniedToolName}`,
          workflowRunId: params.workflowRunId,
          requestId: params.requestId,
          sandboxName: params.sandboxName,
          payload: { toolName: deniedToolName },
        });
      }
    }
    messages = sanitized;

    const result = await openAgent.generate({
      messages,
      options,
      ...(params.extraTools ? { tools: params.extraTools } : {}),
      timeout: { totalMs: DEFAULT_AGENT_TIMEOUT_MS },
    });
    const durationMs = Date.now() - startedAt;
    const toolCallCount = result.steps.reduce(
      (count, item) => count + item.toolCalls.length,
      0,
    );

    await recordBackgroundAgentEvent({
      runId: params.runId,
      agentId: params.agentId,
      userId: params.userId,
      eventName: "background-agent.agent.step.completed",
      status: "succeeded",
      summary: `Agent step ${step} completed with ${result.finishReason}.`,
      workflowRunId: params.workflowRunId,
      requestId: params.requestId,
      sandboxName: params.sandboxName,
      payload: {
        step,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason ?? null,
        durationMs,
        toolCallCount,
        usage: result.usage,
        totalUsage: result.totalUsage,
      },
    });

    // Record token usage to the usage_events table so background-agent
    // consumption is visible in usage dashboards, leaderboards, and public
    // profiles — not just in the background_agent_events JSONB payload.
    if (result.usage) {
      await recordUsage(params.userId, {
        source: "background-agent",
        agentType: "main",
        model: params.recordedModelId,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          cachedInputTokens: result.usage.cachedInputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
        toolCallCount,
      });
    }

    messages.push(...result.response.messages);

    if (result.finishReason !== "tool-calls") {
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.agent.completed",
        status: "succeeded",
        summary: "Background agent completed.",
        workflowRunId: params.workflowRunId,
        requestId: params.requestId,
        sandboxName: params.sandboxName,
        payload: {
          finishReason: result.finishReason,
          steps: step,
        },
      });
      return;
    }
  }

  throw new Error(
    `Background agent exhausted ${DEFAULT_AGENT_MAX_STEPS} steps.`,
  );
}

/**
 * Diffs the pre/post sanitizeUnattendedToolCalls message arrays to recover
 * the tool names that were denied. sanitizeUnattendedToolCalls does not
 * expose the denial list directly (see packages/agent/sanitize-tool-calls.ts
 * contract: same reference when unchanged, new array with injected
 * execution-denied tool-result messages when it rewrote history), so this
 * inspects the synthetic `tool` messages the sanitizer appended.
 */
function collectDeniedToolNames(
  before: ModelMessage[],
  after: ModelMessage[],
): string[] {
  if (before === after) {
    return [];
  }
  const names: string[] = [];
  for (const message of after) {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content as Array<Record<string, unknown>>) {
      const output = part.output as { type?: string } | undefined;
      if (
        part.type === "tool-result" &&
        output?.type === "execution-denied" &&
        typeof part.toolName === "string"
      ) {
        names.push(part.toolName);
      }
    }
  }
  return names;
}

async function prepareWorkingBranch(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  branchName: string;
}) {
  const result = await execObservedCommand({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    sandbox: params.sandbox,
    eventName: "background-agent.git.branch",
    command: `git checkout ${params.branchName} 2>/dev/null || git checkout -b ${params.branchName}`,
    timeoutMs: 30_000,
  });

  if (!result.success) {
    throw new Error("Failed to prepare background-agent working branch.");
  }
}

/**
 * Reconstruct a NormalizedBackgroundTriggerEvent from the stored run columns.
 *
 * The run row persists source, triggerKind, externalId, repoOwner, repoName,
 * prNumber, ref, sha, branch, and payloadSummary (title, url, actor, action).
 * There is no 'merged' column, but for github.pull_request runs that reached
 * this branch the trigger had mergedOnly:true, so the PR was merged when the
 * run was created. We reconstruct merged:true for that kind.
 */
function reconstructEventFromRun(
  run: import("@/lib/db/schema").BackgroundAgentRun,
): NormalizedBackgroundTriggerEvent {
  return {
    source: run.source,
    kind: run.triggerKind,
    externalId: run.externalId,
    repoOwner: run.repoOwner,
    repoName: run.repoName,
    action: run.payloadSummary?.action ?? undefined,
    ref: run.ref ?? undefined,
    sha: run.sha ?? undefined,
    branch: run.branch ?? undefined,
    prNumber: run.prNumber ?? undefined,
    issueNumber: run.issueNumber ?? undefined,
    deploymentUrl: run.deploymentUrl ?? undefined,
    title: run.payloadSummary?.title ?? undefined,
    url: run.payloadSummary?.url ?? undefined,
    actor: run.payloadSummary?.actor ?? undefined,
    // Runs for github.pull_request with mergedOnly:true were always merged
    merged: run.triggerKind === "github.pull_request" ? true : undefined,
  };
}

/**
 * Generates structured learnings candidates from a PR diff using the default
 * LLM. Mirrors the generate pattern in lib/github/pr-content.ts.
 */
async function generateLearnings(prompt: string): Promise<unknown> {
  const result = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    prompt,
    experimental_output: Output.object({
      schema: extractedLearningCandidateSchema
        .array()
        .transform((candidates) => ({
          candidates,
        })),
    }),
  });
  return result.experimental_output;
}

/**
 * Runs the learnings extraction path without a sandbox.
 * Called from executeBackgroundAgentRun when the agent has the learnings marker.
 */
async function executeLearningsAgentRun(params: {
  run: import("@/lib/db/schema").BackgroundAgentRun;
  agentId: string;
  installationId: number;
  repositoryId: number;
  workflowRunId: string;
}) {
  const { run, agentId, installationId, repositoryId, workflowRunId } = params;

  const event = reconstructEventFromRun(run);
  const store = createDbLearningsStore();

  let result: import("@/lib/learnings/runner").RunLearningsExtractionResult;
  try {
    result = await withScopedInstallationOctokit({
      installationId,
      repositoryId,
      permissions: { contents: "read", pull_requests: "read" },
      operation: async (octokit) =>
        runLearningsExtraction({
          event,
          userId: run.userId,
          installationId,
          backgroundAgentRunId: run.id,
          octokit,
          generate: generateLearnings,
          store,
          recordEvent: (eventParams) =>
            recordBackgroundAgentEvent({
              ...(eventParams as Parameters<
                typeof recordBackgroundAgentEvent
              >[0]),
              workflowRunId,
            }).then(() => undefined),
        }),
    });
  } catch (error) {
    await updateBackgroundAgentRunStatus({
      runId: run.id,
      status: "failed",
      workflowRunId,
      errorKind: "workflow_failed",
      errorMessage:
        error instanceof Error ? error.message : "Learnings extraction failed.",
    });
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId,
      userId: run.userId,
      eventName: "learnings-agent.run.failed",
      status: "failed",
      level: "warn",
      summary: "Learnings extraction threw an unexpected error.",
      workflowRunId,
      requestId: run.requestId,
      errorKind: "workflow_failed",
    });
    return;
  }

  if (result.errorKind) {
    await updateBackgroundAgentRunStatus({
      runId: run.id,
      status: "failed",
      workflowRunId,
      errorKind: result.errorKind,
    });
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId,
      userId: run.userId,
      eventName: "learnings-agent.run.failed",
      status: "failed",
      level: "warn",
      summary: `Learnings extraction failed: ${result.errorKind}`,
      workflowRunId,
      requestId: run.requestId,
      errorKind: result.errorKind,
    });
    return;
  }

  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "succeeded",
    workflowRunId,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId,
    userId: run.userId,
    eventName: "learnings-agent.run.succeeded",
    summary: `Learnings extraction completed: ${result.accepted} accepted, ${result.rejected} rejected.`,
    status: "succeeded",
    workflowRunId,
    requestId: run.requestId,
    payload: {
      candidatesExtracted: result.candidatesExtracted,
      accepted: result.accepted,
      merged: result.merged,
      rejected: result.rejected,
    },
  });
}

export async function executeBackgroundAgentRun(params: {
  runId: string;
  workflowRunId: string;
}) {
  "use step";

  const row = await getBackgroundAgentRunWithAgent(params.runId);
  if (!row) {
    return;
  }

  const { run, agent } = row;
  const sandboxName = buildSandboxName(run.id);

  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "running",
    workflowRunId: params.workflowRunId,
    sandboxName,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.workflow.started",
    status: "running",
    summary: "Background agent workflow started.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });

  if (!agent) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "agent_disabled",
      summary: "Background agent configuration was deleted before execution.",
    });
    return;
  }

  const githubActionToggles = toGitHubActionToggles(agent.githubActions);
  const requiredUserPermission = hasAnyWriteAction(githubActionToggles)
    ? "write"
    : "read";

  const access = await verifyRepoAccess({
    userId: run.userId,
    owner: run.repoOwner,
    repo: run.repoName,
    requiredUserPermission,
  });
  if (!access.ok) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind:
        access.reason === "no_installation" || access.reason === "app_no_access"
          ? "installation_missing"
          : "permission_missing",
      summary: getRepoAccessErrorMessage(access.reason),
    });
    return;
  }

  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.github.installation.resolved",
    status: "succeeded",
    summary: "Resolved repo-scoped GitHub App installation access.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    payload: {
      repositoryId: access.repositoryId,
      defaultBranch: access.defaultBranch,
    },
  });

  // ── Built-in learnings agent branch ──────────────────────────────────────
  // Detected by marker in instructions. Runs extraction without sandbox —
  // do not pay sandbox costs for this read-only arc.
  if (isLearningsAgent(agent)) {
    await executeLearningsAgentRun({
      run,
      agentId: agent.id,
      installationId: access.installationId,
      repositoryId: access.repositoryId,
      workflowRunId: params.workflowRunId,
    });
    return;
  }

  // ── Resolve model selection before paying sandbox costs ──────────────────
  // A misconfigured explicit model selection must fail the run rather than
  // silently fall back — the user chose this model. Failing before sandbox
  // setup avoids paying sandbox costs for a run that cannot proceed.
  let resolvedModelSelection: AgentModelSelection | undefined;
  try {
    resolvedModelSelection = await resolveBackgroundAgentModel({
      userId: run.userId,
      modelId: agent.modelId,
    });
  } catch (error) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "model_resolution_failed",
      summary:
        error instanceof Error
          ? error.message
          : "Failed to resolve the agent's selected model.",
    });
    return;
  }
  const recordedModelId = resolvedModelSelection?.id ?? defaultModelLabel;

  let setupToken: ScopedInstallationToken | undefined;
  let sandbox: Sandbox | undefined;
  try {
    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        sandboxName,
        source: {
          repo: `https://github.com/${run.repoOwner}/${run.repoName}.git`,
          branch: run.ref ?? run.branch ?? access.defaultBranch,
        },
      },
      options: {
        githubToken: setupToken.token,
        gitUser: await getGitUser(run.userId),
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
  } catch (error) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "sandbox_unavailable",
      summary:
        error instanceof Error
          ? error.message
          : "Failed to start background sandbox.",
    });
    return;
  } finally {
    if (setupToken) {
      await revokeInstallationToken(setupToken.token);
    }
  }

  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.sandbox.started",
    status: "succeeded",
    summary: "Background sandbox is ready.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    payload: {
      sandboxName,
      workingDirectory: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      host: sandbox.host,
    },
  });

  await execObservedCommand({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
    sandbox,
    eventName: "background-agent.git.context",
    command: "git status --short && git rev-parse --short HEAD",
    timeoutMs: 15_000,
  });

  // ── Prepare a run-scoped working branch when any write action is enabled ─
  // Gives github_push a sane default target branch instead of the repo's
  // default branch. Comment/review-only agents skip this — there is nothing
  // to push.
  let workingBranch: string | null = null;
  if (hasAnyWriteAction(githubActionToggles)) {
    workingBranch = buildBackgroundBranchName({
      agentName: agent.name,
      runId: run.id,
    });

    try {
      await prepareWorkingBranch({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        sandbox,
        branchName: workingBranch,
      });
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.git.branch.resolved",
        status: "succeeded",
        summary: "Prepared background-agent working branch.",
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        payload: { branchName: workingBranch },
      });
    } catch (error) {
      await recordFailure({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        errorKind: "workflow_failed",
        summary:
          error instanceof Error
            ? error.message
            : "Failed to prepare background-agent working branch.",
      });
      return;
    }
  }

  // ── Resolve Composio tools for this run ──────────────────────────────────
  // Attempted when the agent has non-empty composioToolkitSlugs.
  // Empty slugs = no-op (pre-Phase-5 behavior).
  // The resolver handles repo policy gating. Grant-level gating is checked
  // here: if no enabled grants exist, slugs are cleared before resolving
  // so the resolver fast-paths to { status: "off" } without external calls.
  let resolvedComposioTools: import("ai").ToolSet | undefined;
  const agentToolkitSlugs = agent.composioToolkitSlugs ?? [];

  if (agentToolkitSlugs.length > 0) {
    const composioResult = await resolveComposioToolsForBgRun({
      agentId: run.agentId,
      runId: run.id,
      userId: run.userId,
      slugs: agentToolkitSlugs,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
    });

    if (composioResult.status === "ready") {
      resolvedComposioTools = composioResult.tools;
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.composio.resolved",
        status: "succeeded",
        summary: `Resolved Composio tools: ${composioResult.toolkitSlugs.join(", ")}.`,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        // Payload: toolkit names only — no secrets, no API keys.
        payload: {
          toolkitSlugs: composioResult.toolkitSlugs,
          toolCount: Object.keys(composioResult.tools).length,
        },
      });
    } else if (composioResult.status === "error") {
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.composio.error",
        status: "failed",
        level: "warn",
        summary: `Composio tool resolution failed: ${composioResult.error}`,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        payload: {
          // Do NOT include error details that might contain secrets
          toolkitSlugsRequested: agentToolkitSlugs,
        },
      });
      // Non-fatal: run continues without Composio tools.
    }
  }

  // ── Resolve native GitHub action tools, filtered by the agent's toggles ──
  const githubActionTools = resolveGitHubActionTools({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    workflowRunId: params.workflowRunId,
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    repoOwner: run.repoOwner,
    repoName: run.repoName,
    defaultBranch: access.defaultBranch,
    sandbox,
    toggles: githubActionToggles,
    writeScope: toGitHubToolsWriteScope(agent.writeScope),
    requireCiGreen: agent.requireCiGreenForMerge ?? true,
    userPermission: access.userPermission,
    outputKindByAction: buildOutputKindByAction(),
  });

  const extraTools = mergeExtraTools(
    resolvedComposioTools,
    // mergeExtraTools treats a defined-but-empty ToolSet as "has tools" (it
    // only short-circuits to undefined when BOTH inputs are absent) — pass
    // undefined instead of {} when no GitHub actions are toggled on so a
    // comment-only-disabled agent doesn't get a spurious empty tools key.
    Object.keys(githubActionTools).length > 0 ? githubActionTools : undefined,
  );

  // ── Every run now executes the agent loop ────────────────────────────────
  try {
    await runBackgroundAgent({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      sandbox,
      prompt: buildBackgroundAgentRunbookPrompt({
        agentName: agent.name,
        instructions: agent.instructions,
        triggerKind: run.triggerKind,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        ref: run.ref,
        sha: run.sha,
        branch: run.branch,
        prNumber: run.prNumber,
        issueNumber: run.issueNumber,
        deploymentUrl: run.deploymentUrl,
        payloadSummary: run.payloadSummary,
        checkCommand: agent.checkCommand,
        workingBranch,
        enabledGithubActionTools: enabledGithubActionToolNames(
          agent.githubActions,
        ),
      }),
      extraTools,
      allowedBuiltinToolNames: agent.builtinToolNames ?? null,
      modelSelection: resolvedModelSelection,
      recordedModelId,
    });
  } catch (error) {
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "workflow_failed",
      summary:
        error instanceof Error ? error.message : "Background agent failed.",
    });
    return;
  }

  if (agent.checkCommand?.trim()) {
    const checkResult = await execObservedCommand({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      sandbox,
      eventName: "background-agent.check",
      command: agent.checkCommand.trim(),
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
    });

    if (!checkResult.success) {
      await recordFailure({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        errorKind: "checks_failed",
        summary: "Required background-agent check failed.",
      });
      return;
    }
  } else {
    await recordBackgroundAgentEvent({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      eventName: "background-agent.check.completed",
      status: "skipped",
      summary: "No check command configured.",
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
    });
  }

  // Terminal success: the outputUrl is the URL of the most recent successful
  // GitHub action output recorded for this run, if any.
  const outputs = await listBackgroundAgentOutputs(run.id);
  const latestOutputWithUrl = outputs.find(
    (output) => output.status === "created" && output.url,
  );

  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "succeeded",
    workflowRunId: params.workflowRunId,
    sandboxName,
    outputUrl: latestOutputWithUrl?.url ?? null,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.run.completed",
    status: "succeeded",
    summary: "Background agent run completed.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
    sandboxName,
  });

  // Summary must not affect run status on failure.
  try {
    await buildAndPersistRunSummary({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
    });
  } catch (summaryError) {
    try {
      await recordSummaryFailedEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        error: summaryError,
      });
    } catch {
      // Best-effort; do not re-throw.
    }
  }
}
