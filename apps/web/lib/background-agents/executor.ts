import "server-only";

import { connectSandbox, type Sandbox } from "@open-agents/sandbox";
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
  type ScopedInstallationToken,
} from "@/lib/github/app";
import { getGitHubUserProfile } from "@/lib/github/users";
import {
  getBackgroundAgentRunWithAgent,
  recordBackgroundAgentEvent,
  updateBackgroundAgentRunStatus,
} from "./store";
import { buildBackgroundCommandObservation } from "./runtime-observability";

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;

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
    await recordFailure({
      runId: run.id,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      sandboxName,
      errorKind: "workflow_failed",
      summary:
        "Ready PR mutation is not enabled yet; sandbox and check evidence were recorded.",
    });
    return;
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
}
