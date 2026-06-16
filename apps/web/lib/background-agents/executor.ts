import "server-only";

import {
  gateway,
  openAgent,
  type OpenAgentCallOptions,
  sanitizeUnattendedToolCalls,
} from "@open-agents/agent";
import {
  connectSandbox,
  getCurrentBranch,
  getStagedDiff,
  hasUncommittedChanges,
  stageAll,
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
import { buildCoAuthor, createCommit } from "@/lib/github/commit";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import { openPullRequest } from "@/lib/github/pulls";
import { getGitHubAppUserToken } from "@/lib/github/token";
import { getGitHubUserProfile } from "@/lib/github/users";
import {
  getBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
  recordBackgroundAgentEvent,
  recordBackgroundAgentOutput,
  updateBackgroundAgentRunStatus,
} from "./store";
import { resolveComposioToolsForBgRun } from "./composio-tools";
import { buildRunSummary } from "./run-summary";
import {
  persistRunSummary,
  recordSummaryFailedEvent,
} from "./run-summary-persist";
import { buildBackgroundCommandObservation } from "./runtime-observability";
import {
  buildBackgroundAgentMutationPrompt,
  buildBackgroundBranchName,
  buildBackgroundPullRequestBody,
  buildBackgroundPullRequestTitle,
} from "./ready-pr";
import type {
  BackgroundAgentTriggerKind,
  NormalizedBackgroundTriggerEvent,
} from "./types";
import { isLearningsAgent } from "@/lib/learnings/builtin-agent";
import { runLearningsExtraction } from "@/lib/learnings/runner";
import { createDbLearningsStore } from "@/lib/learnings/store";
import { generateText, Output } from "ai";
import { extractedLearningCandidateSchema } from "@/lib/learnings/types";

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_TIMEOUT_MS = 600_000;
const DEFAULT_AGENT_MAX_STEPS = 8;

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

function resolveAppBaseUrl(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL,
    process.env.VERCEL_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    const url =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    try {
      return new URL(url).origin;
    } catch {
      continue;
    }
  }

  return null;
}

async function runMutationAgent(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  prompt: string;
  /** Optional Composio tools to inject into the agent loop. */
  composioTools?: import("ai").ToolSet;
  /** Pre-approved built-in tool names. null/absent = default policy. */
  allowedBuiltinToolNames?: string[] | null;
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
    customInstructions:
      "You are running inside an unattended background-agent workflow. Work autonomously, keep changes scoped, and finish with a concise summary.",
  };

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.agent.started",
    status: "running",
    summary: "Background mutation agent started.",
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      maxSteps: DEFAULT_AGENT_MAX_STEPS,
      timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
    },
  });

  for (let step = 1; step <= DEFAULT_AGENT_MAX_STEPS; step += 1) {
    const startedAt = Date.now();
    // Repair any approval-gated tool call the previous turn left without a
    // result before re-sending history — otherwise the provider rejects the
    // request ("Tool result is missing for tool call …") and fails the run.
    messages = sanitizeUnattendedToolCalls(messages);
    const result = await openAgent.generate({
      messages,
      options,
      ...(params.composioTools ? { tools: params.composioTools } : {}),
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
      summary: `Mutation agent step ${step} completed with ${result.finishReason}.`,
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

    messages.push(...result.response.messages);

    if (result.finishReason !== "tool-calls") {
      await recordBackgroundAgentEvent({
        runId: params.runId,
        agentId: params.agentId,
        userId: params.userId,
        eventName: "background-agent.agent.completed",
        status: "succeeded",
        summary: "Background mutation agent completed.",
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
    `Background mutation agent exhausted ${DEFAULT_AGENT_MAX_STEPS} steps.`,
  );
}

async function prepareReadyPullRequestBranch(params: {
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
    throw new Error("Failed to prepare background-agent PR branch.");
  }
}

async function createReadyPullRequestOutput(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  sandboxName: string;
  sandbox: Sandbox;
  agentName: string;
  repoOwner: string;
  repoName: string;
  branchName: string;
  baseBranch: string;
  installationId: number;
  repositoryId: number;
  checkCommand?: string | null;
  triggerKind: BackgroundAgentTriggerKind;
}) {
  if (!(await hasUncommittedChanges(params.sandbox))) {
    await recordBackgroundAgentOutput({
      runId: params.runId,
      userId: params.userId,
      kind: "ready_pr",
      status: "skipped",
      payload: {
        reason: "no_changes",
      },
    });
    throw new Error("Background agent completed without file changes.");
  }

  await stageAll(params.sandbox);
  const diff = await getStagedDiff(params.sandbox);
  const commitMessage =
    diff.trim().length > 0
      ? `chore: apply ${params.agentName} background changes`
      : "chore: apply background agent changes";
  const coAuthor = await buildCoAuthor(params.userId);
  const intentResult = await buildCommitIntentFromSandbox({
    sandbox: params.sandbox,
    owner: params.repoOwner,
    repo: params.repoName,
    repositoryId: params.repositoryId,
    installationId: params.installationId,
    branch: params.branchName,
    baseBranch: params.baseBranch,
    message: commitMessage.slice(0, 72),
    ...(coAuthor ? { coAuthor } : {}),
  });

  if (!intentResult.ok) {
    throw new Error(intentResult.error);
  }

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.commit.started",
    status: "running",
    summary: "Creating verified GitHub App commit for background changes.",
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      branchName: params.branchName,
      fileCount: intentResult.intent.files.length,
    },
  });

  const commitResult = await withScopedInstallationOctokit({
    installationId: intentResult.intent.installationId,
    repositoryId: intentResult.intent.repositoryId,
    permissions: { contents: "write" },
    operation: async (octokit) =>
      createCommit({
        octokit,
        owner: intentResult.intent.owner,
        repo: intentResult.intent.repo,
        branch: intentResult.intent.branch,
        expectedHeadSha: intentResult.intent.expectedHeadSha,
        message: intentResult.intent.message,
        files: intentResult.intent.files,
        ...(intentResult.intent.baseBranch
          ? { baseBranch: intentResult.intent.baseBranch }
          : {}),
        ...(intentResult.intent.coAuthor
          ? { coAuthor: intentResult.intent.coAuthor }
          : {}),
      }),
  });

  if (!commitResult.ok) {
    throw new Error(commitResult.error);
  }

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.commit.completed",
    status: "succeeded",
    summary: "Verified GitHub App commit created.",
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      branchName: params.branchName,
      commitSha: commitResult.commitSha,
    },
  });

  const userToken = await getGitHubAppUserToken(params.userId);
  if (!userToken) {
    throw new Error("GitHub user token is required to open a pull request.");
  }

  const appBaseUrl = resolveAppBaseUrl();
  const runUrl = appBaseUrl
    ? `${appBaseUrl}/background-runs/${encodeURIComponent(params.runId)}`
    : null;
  const prResult = await openPullRequest({
    repoUrl: `https://github.com/${params.repoOwner}/${params.repoName}`,
    branchName: params.branchName,
    title: buildBackgroundPullRequestTitle(params.agentName),
    body: buildBackgroundPullRequestBody({
      runId: params.runId,
      agentName: params.agentName,
      triggerKind: params.triggerKind,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      baseBranch: params.baseBranch,
      branchName: params.branchName,
      commitSha: commitResult.commitSha,
      checkCommand: params.checkCommand,
      runUrl,
    }),
    baseBranch: params.baseBranch,
    token: userToken,
  });

  if (!prResult.success || !prResult.prUrl) {
    throw new Error(prResult.error ?? "Failed to create pull request.");
  }

  await recordBackgroundAgentOutput({
    runId: params.runId,
    userId: params.userId,
    kind: "ready_pr",
    status: "created",
    url: prResult.prUrl,
    prNumber: prResult.prNumber ?? null,
    payload: {
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      commitSha: commitResult.commitSha,
    },
  });
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.output.created",
    status: "succeeded",
    summary: `Created ready PR${prResult.prNumber ? ` #${prResult.prNumber}` : ""}.`,
    workflowRunId: params.workflowRunId,
    requestId: params.requestId,
    sandboxName: params.sandboxName,
    payload: {
      outputKind: "ready_pr",
      prNumber: prResult.prNumber ?? null,
      url: prResult.prUrl,
    },
  });

  return prResult;
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
    status: "succeeded",
    summary: `Learnings extraction completed: ${result.accepted} accepted, ${result.rejected} rejected.`,
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

  const access = await verifyRepoAccess({
    userId: run.userId,
    owner: run.repoOwner,
    repo: run.repoName,
    requiredUserPermission: agent.outputMode === "ready_pr" ? "write" : "read",
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

  // ── Phase 5: resolve Composio tools for this run ─────────────────────────
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

  let readyPrBranchName: string | null = null;
  if (agent.outputMode === "ready_pr") {
    readyPrBranchName = buildBackgroundBranchName({
      agentName: agent.name,
      runId: run.id,
    });

    try {
      await prepareReadyPullRequestBranch({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        sandbox,
        branchName: readyPrBranchName,
      });
      await runMutationAgent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        sandbox,
        prompt: buildBackgroundAgentMutationPrompt({
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
        }),
        composioTools: resolvedComposioTools,
      });
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.git.branch.resolved",
        status: "succeeded",
        summary: "Prepared background-agent PR branch.",
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        payload: {
          branchName: await getCurrentBranch(sandbox),
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
        errorKind: "workflow_failed",
        summary:
          error instanceof Error
            ? error.message
            : "Background mutation agent failed.",
      });
      return;
    }
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

  if (agent.outputMode === "ready_pr") {
    try {
      const prResult = await createReadyPullRequestOutput({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        sandbox,
        agentName: agent.name,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        branchName: readyPrBranchName ?? (await getCurrentBranch(sandbox)),
        baseBranch: access.defaultBranch,
        installationId: access.installationId,
        repositoryId: access.repositoryId,
        checkCommand: agent.checkCommand,
        triggerKind: run.triggerKind,
      });

      await updateBackgroundAgentRunStatus({
        runId: run.id,
        status: "succeeded",
        workflowRunId: params.workflowRunId,
        sandboxName,
        outputUrl: prResult.prUrl ?? null,
      });
      await recordBackgroundAgentEvent({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        eventName: "background-agent.run.completed",
        status: "succeeded",
        summary: "Background agent created a ready PR with evidence.",
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
      return;
    } catch (error) {
      await recordBackgroundAgentOutput({
        runId: run.id,
        userId: run.userId,
        kind: "ready_pr",
        status: "failed",
        payload: {
          reason:
            error instanceof Error
              ? error.message
              : "Ready PR output creation failed.",
        },
      });
      await recordFailure({
        runId: run.id,
        agentId: run.agentId,
        userId: run.userId,
        workflowRunId: params.workflowRunId,
        requestId: run.requestId,
        sandboxName,
        errorKind: "pr_creation_failed",
        summary:
          error instanceof Error
            ? error.message
            : "Ready PR output creation failed.",
      });
      return;
    }
  }

  await updateBackgroundAgentRunStatus({
    runId: run.id,
    status: "succeeded",
    workflowRunId: params.workflowRunId,
    sandboxName,
  });
  await recordBackgroundAgentEvent({
    runId: run.id,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.run.completed",
    status: "succeeded",
    summary: "Background agent run completed with sandbox evidence.",
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
