import "server-only";

import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { redactHarnessPayload } from "@/lib/harness/redaction";
import { emitSessionEvent } from "@/lib/observability/events";

export type GithubActionsActionEvent = {
  action: "workflow.dispatch" | "run.rerun" | "run.rerun_failed" | "run.cancel";
  userId: string;
  requestId: string;
  installationId: number;
  repoId: number;
  repoOwner: string;
  repoName: string;
  workflowId?: string;
  runId?: number;
  dispatchRef?: string;
  inputKeys?: string[];
  inputs?: Record<string, string>;
  errorKind?: string;
  redactionStatus: "not_required" | "passed" | "failed" | "blocked";
};

export function getActionsManagerSessionId(params: {
  installationId: number;
  repoId: number;
}) {
  return `github-actions:${params.installationId}:${params.repoId}`;
}

async function ensureActionsAuditSession(params: {
  sessionId: string;
  userId: string;
  repoOwner: string;
  repoName: string;
}) {
  await db
    .insert(sessions)
    .values({
      id: params.sessionId,
      userId: params.userId,
      title: `GitHub Actions audit: ${params.repoOwner}/${params.repoName}`,
      status: "archived",
      repoOwner: params.repoOwner,
      repoName: params.repoName,
    })
    .onConflictDoNothing();
}

function buildPayload(event: GithubActionsActionEvent) {
  const inputKeys = event.inputKeys ?? Object.keys(event.inputs ?? {});
  const redactedInputs =
    event.inputs && inputKeys.length > 0
      ? redactHarnessPayload(event.inputs)
      : undefined;

  return {
    service: "github-actions-manager",
    action: event.action,
    scope: "repository",
    userId: event.userId,
    sessionId: getActionsManagerSessionId(event),
    requestId: event.requestId,
    installationId: event.installationId,
    repoId: event.repoId,
    repoOwner: event.repoOwner,
    repoName: event.repoName,
    workflowId: event.workflowId,
    runId: event.runId,
    dispatchRef: event.dispatchRef,
    inputKeys,
    redactedInputs,
    errorKind: event.errorKind,
    redactionStatus: event.redactionStatus,
  };
}

export async function emitActionsManagerEvent(event: GithubActionsActionEvent) {
  const sessionId = getActionsManagerSessionId(event);
  await ensureActionsAuditSession({
    sessionId,
    userId: event.userId,
    repoOwner: event.repoOwner,
    repoName: event.repoName,
  });

  return emitSessionEvent({
    sessionId,
    userId: event.userId,
    source: "github-actions-manager",
    actorType: "github",
    eventName: event.action,
    status: event.errorKind ? "failed" : "info",
    requestId: event.requestId,
    summary: event.errorKind
      ? `${event.action} failed for ${event.repoOwner}/${event.repoName}`
      : `${event.action} for ${event.repoOwner}/${event.repoName}`,
    payload: buildPayload(event),
    redactionStatus: event.redactionStatus,
  });
}
