import type { BackgroundAgentRun } from "@/lib/db/schema";
import {
  buildNormalizedBackgroundLearningsInput,
  buildNormalizedBackgroundSandboxInput,
  type NormalizedUnattendedStepInputV1,
} from "@/lib/unattended-runtime/normalized-step-input";
import type { ResolvedBackgroundAgentExecutionDefinition } from "./execution-snapshot";

type NormalizedBackgroundStepInput = Extract<
  NormalizedUnattendedStepInputV1,
  { source: "background_agent" }
>;

function buildTrigger(run: BackgroundAgentRun) {
  return {
    kind: run.triggerKind,
    ref: run.ref,
    sha: run.sha,
    branch: run.branch,
    prNumber: run.prNumber,
    issueNumber: run.issueNumber,
    deploymentUrl: run.deploymentUrl,
    summary: {
      title: run.payloadSummary?.title,
      url: run.payloadSummary?.url,
      actor: run.payloadSummary?.actor,
      action: run.payloadSummary?.action,
      environment: run.payloadSummary?.environment,
      severity: run.payloadSummary?.severity,
      message: run.payloadSummary?.message,
    },
  };
}

export function buildNormalizedBackgroundStepInput(params: {
  run: BackgroundAgentRun;
  resolvedDefinition: ResolvedBackgroundAgentExecutionDefinition;
  workflowRunId: string;
  sandboxName: string;
  defaultBranch: string;
}): NormalizedBackgroundStepInput {
  const identity = {
    runId: params.run.id,
    userId: params.run.userId,
    triggerId: params.run.triggerId,
    requestId: params.run.requestId,
    workflowRunId: params.workflowRunId,
  };
  const repositoryIntent = {
    ref: params.run.ref,
    sha: params.run.sha,
    branch: params.run.branch,
    defaultBranch: params.defaultBranch,
  };
  const trigger = buildTrigger(params.run);

  if (
    params.resolvedDefinition.definition.source.builtinKind ===
    "pr_review_learnings"
  ) {
    return buildNormalizedBackgroundLearningsInput({
      resolvedDefinition: params.resolvedDefinition,
      identity,
      repositoryIntent,
      trigger,
    });
  }

  const initialCheckout = params.run.ref
    ? { ref: params.run.ref, source: "event_ref" as const }
    : params.run.branch
      ? { ref: params.run.branch, source: "event_branch" as const }
      : {
          ref: params.defaultBranch,
          source: "live_default_branch" as const,
        };

  return buildNormalizedBackgroundSandboxInput({
    resolvedDefinition: params.resolvedDefinition,
    identity,
    repositoryIntent,
    trigger,
    workspace: {
      sandboxName: params.sandboxName,
      initialCheckout,
    },
  });
}
