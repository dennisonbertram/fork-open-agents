import "server-only";

import { emitSessionEvent } from "@/lib/observability/events";

export type ActionsMutationAction =
  | "workflow.dispatch"
  | "run.rerun"
  | "run.rerun_failed"
  | "run.cancel";

export async function emitActionsMutationEvent(params: {
  userId: string;
  installationId: number;
  repoId: number;
  repoOwner: string;
  repoName: string;
  action: ActionsMutationAction;
  workflowId?: string;
  runId?: number;
  dispatchRef?: string;
}): Promise<void> {
  const sessionId = `github-actions:${params.installationId}:${params.repoId}`;
  const requestId = crypto.randomUUID();

  await emitSessionEvent({
    sessionId,
    userId: params.userId,
    source: "github",
    actorType: "user",
    actorId: params.userId,
    eventName: `github-actions.${params.action}`,
    status: "info",
    summary: `${params.action} for ${params.repoOwner}/${params.repoName}`,
    requestId,
    workflowRunId: params.runId != null ? String(params.runId) : null,
    payload: {
      workflowId: params.workflowId,
      runId: params.runId,
      dispatchRef: params.dispatchRef,
    },
  });
}
