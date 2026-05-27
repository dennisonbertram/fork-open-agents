import { getWorkflowMetadata } from "workflow";
import {
  getBackgroundAgentRun,
  recordBackgroundAgentEvent,
  updateBackgroundAgentRunStatus,
} from "@/lib/background-agents/store";
import { getInstallationsByUserId } from "@/lib/db/installations";

async function hasRepoInstallationAccess(params: {
  userId: string;
  repoOwner: string;
}) {
  const installations = await getInstallationsByUserId(params.userId);
  return installations.some(
    (installation) =>
      installation.accountLogin.toLowerCase() ===
      params.repoOwner.toLowerCase(),
  );
}

async function failRun(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  workflowRunId: string;
  requestId: string | null;
  errorKind: string;
  summary: string;
}) {
  await updateBackgroundAgentRunStatus({
    runId: params.runId,
    status: "failed",
    workflowRunId: params.workflowRunId,
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
    errorKind: params.errorKind,
  });
}

async function executeBackgroundAgentFoundationRun(params: {
  runId: string;
  workflowRunId: string;
}) {
  "use step";

  const run = await getBackgroundAgentRun(params.runId);
  if (!run) {
    return;
  }

  await updateBackgroundAgentRunStatus({
    runId: params.runId,
    status: "running",
    workflowRunId: params.workflowRunId,
  });
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.workflow.started",
    status: "running",
    summary: "Background agent workflow started.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });

  const hasInstallation = await hasRepoInstallationAccess({
    userId: run.userId,
    repoOwner: run.repoOwner,
  });
  if (!hasInstallation) {
    await failRun({
      runId: params.runId,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      errorKind: "installation_missing",
      summary:
        "GitHub App installation access is missing for this repository owner.",
    });
    return;
  }

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.github.installation.resolved",
    status: "succeeded",
    summary: "Resolved repo-scoped GitHub App installation access.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });

  if (run.outputKind === "ready_pr") {
    await recordBackgroundAgentEvent({
      runId: params.runId,
      agentId: run.agentId,
      userId: run.userId,
      eventName: "background-agent.executor.pending",
      status: "failed",
      level: "warn",
      summary:
        "Ready PR execution is tracked for the executor slice and is not enabled by this foundation workflow.",
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      errorKind: "workflow_failed",
    });
    await failRun({
      runId: params.runId,
      agentId: run.agentId,
      userId: run.userId,
      workflowRunId: params.workflowRunId,
      requestId: run.requestId,
      errorKind: "workflow_failed",
      summary: "Ready PR execution is not enabled yet.",
    });
    return;
  }

  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.executor.pending",
    status: "skipped",
    summary:
      "Executor is not enabled in this foundation slice. This run recorded trigger and workflow evidence only.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });

  await updateBackgroundAgentRunStatus({
    runId: params.runId,
    status: "succeeded",
    workflowRunId: params.workflowRunId,
  });
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: run.agentId,
    userId: run.userId,
    eventName: "background-agent.run.completed",
    status: "succeeded",
    summary: "Background agent foundation run completed.",
    workflowRunId: params.workflowRunId,
    requestId: run.requestId,
  });
}

export async function runBackgroundAgentWorkflow(input: { runId: string }) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  await executeBackgroundAgentFoundationRun({
    runId: input.runId,
    workflowRunId,
  });
}
