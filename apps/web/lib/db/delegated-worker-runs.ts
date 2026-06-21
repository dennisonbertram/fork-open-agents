import { getToolName, isToolUIPart } from "ai";
import { and, desc, eq } from "drizzle-orm";
import type { WebAgentUIMessage } from "@/app/types";
import { db } from "./client";
import {
  delegatedWorkerRuns,
  type DelegatedWorkerLifecycleEvent,
  type DelegatedWorkerCompletionPacket,
  type DelegatedWorkerRun,
  type DelegatedWorkerRunEvidenceRef,
  type NewDelegatedWorkerRun,
} from "./schema";

export const DELEGATED_WORKER_RUN_STATUSES = [
  "planned",
  "launching",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "stale",
] as const;

export type DelegatedWorkerRunStatus =
  (typeof DELEGATED_WORKER_RUN_STATUSES)[number];

const TERMINAL_STATUSES = new Set<DelegatedWorkerRunStatus>([
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);

const VALID_TRANSITIONS: Record<DelegatedWorkerRunStatus, Set<string>> = {
  planned: new Set(["launching", "running", "blocked", "cancelled"]),
  launching: new Set(["running", "blocked", "failed", "cancelled"]),
  running: new Set(["blocked", "completed", "failed", "cancelled", "stale"]),
  blocked: new Set(),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  stale: new Set(),
};

type TaskOutputRecord = {
  final?: unknown;
  runtime?: {
    mode?: unknown;
    workerType?: unknown;
    profileId?: unknown;
    profileVersion?: unknown;
    profileRunId?: unknown;
    sandboxName?: unknown;
  };
  workspacePolicy?: {
    requestedPolicy?: unknown;
    effectivePolicy?: unknown;
    executionMode?: unknown;
  };
  workspaceResolution?: {
    status?: unknown;
    decision?: unknown;
    requestedPolicy?: unknown;
    effectivePolicy?: unknown;
    parentWorkspaceId?: unknown;
    reasonCode?: unknown;
  };
  sharedWriterLease?: {
    status?: unknown;
    workspaceId?: unknown;
    workerId?: unknown;
  };
  sharedWorkspaceBaseline?: {
    status?: unknown;
    baselineKind?: unknown;
  };
  sharedWorkspaceDrift?: {
    status?: unknown;
    reasonCode?: unknown;
  };
  isolatedWorkspace?: {
    status?: unknown;
    parentWorkspaceId?: unknown;
    childWorkspaceId?: unknown;
    sourceRef?: unknown;
    sourceCommit?: unknown;
    createdAt?: unknown;
  };
  usage?: unknown;
  completionPacket?: unknown;
  completionPacketValidation?: {
    status?: unknown;
    reasonCode?: unknown;
    reason?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asTaskOutput(value: unknown): TaskOutputRecord | null {
  return isRecord(value) ? (value as TaskOutputRecord) : null;
}

function asWorkspacePolicy(value: string | null) {
  return value === "auto" || value === "shared" || value === "isolated"
    ? value
    : null;
}

function asWorkspaceMode(value: string | null) {
  return value === "shared" || value === "isolated" ? value : null;
}

function asCompletionPacket(
  value: unknown,
): DelegatedWorkerCompletionPacket | null {
  if (!isRecord(value)) {
    return null;
  }

  const packet = value as DelegatedWorkerCompletionPacket;
  return packet.version === 1 &&
    typeof packet.workerId === "string" &&
    typeof packet.summary === "string"
    ? packet
    : null;
}

function asCompletionPacketValidationStatus(value: string | null) {
  return value === "valid" ||
    value === "invalid" ||
    value === "missing" ||
    value === "partial"
    ? value
    : null;
}

function statusFromTaskPart(part: {
  state?: string;
  output?: TaskOutputRecord | null;
}): { status: DelegatedWorkerRunStatus; reasonCode: string } {
  if (part.state === "output-error") {
    return { status: "failed", reasonCode: "task_output_error" };
  }

  const driftStatus = asString(part.output?.sharedWorkspaceDrift?.status);
  if (driftStatus === "blocked" || driftStatus === "unsupported") {
    return {
      status: "blocked",
      reasonCode:
        asString(part.output?.sharedWorkspaceDrift?.reasonCode) ??
        "workspace_drift_blocked",
    };
  }

  if (part.output?.final) {
    if (part.output.completionPacketValidation?.status === "invalid") {
      return {
        status: "completed",
        reasonCode: "worker_completion_packet_invalid",
      };
    }
    return { status: "completed", reasonCode: "worker_terminal" };
  }

  if (part.output) {
    return { status: "running", reasonCode: "worker_output_available" };
  }

  return { status: "launching", reasonCode: "worker_launch_recorded" };
}

function buildEvidenceRefs(output: TaskOutputRecord | null) {
  const refs: DelegatedWorkerRunEvidenceRef[] = [
    { kind: "task_output", ref: "tool-task.output" },
  ];

  if (output?.runtime) {
    refs.push({ kind: "runtime", ref: "tool-task.output.runtime" });
  }

  if (output?.workspacePolicy || output?.workspaceResolution) {
    refs.push({ kind: "workspace", ref: "tool-task.output.workspace" });
  }

  if (output?.isolatedWorkspace) {
    refs.push({ kind: "workspace", ref: "tool-task.output.isolatedWorkspace" });
  }

  if (output?.usage) {
    refs.push({ kind: "usage", ref: "tool-task.output.usage" });
  }

  if (output?.completionPacket || output?.completionPacketValidation) {
    refs.push({
      kind: "completion_packet",
      ref: "tool-task.output.completionPacket",
    });
  }

  return refs;
}

export function canTransitionDelegatedWorkerRun(
  from: DelegatedWorkerRunStatus,
  to: DelegatedWorkerRunStatus,
): boolean {
  if (from === to) {
    return true;
  }

  if (TERMINAL_STATUSES.has(from)) {
    return false;
  }

  return VALID_TRANSITIONS[from].has(to);
}

export function buildDelegatedWorkerRunRecordsFromMessage(params: {
  message: WebAgentUIMessage;
  workflowRunId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  now?: Date;
}): NewDelegatedWorkerRun[] {
  const now = params.now ?? new Date();
  const rows: NewDelegatedWorkerRun[] = [];

  for (const part of params.message.parts) {
    if (!isToolUIPart(part)) {
      continue;
    }

    const toolName = getToolName(part);
    if (toolName !== "task" && part.type !== "tool-task") {
      continue;
    }

    const parentToolCallId = asString(part.toolCallId);
    if (!parentToolCallId) {
      continue;
    }

    const output = asTaskOutput(part.output);
    const input = isRecord(part.input) ? part.input : {};
    const runtime = output?.runtime;
    const workspacePolicy = output?.workspacePolicy;
    const workspaceResolution = output?.workspaceResolution;
    const sharedWriterLease = output?.sharedWriterLease;
    const isolatedWorkspace = output?.isolatedWorkspace;
    const completionPacket = asCompletionPacket(output?.completionPacket);
    const completionPacketValidationStatus =
      asCompletionPacketValidationStatus(
        asString(output?.completionPacketValidation?.status),
      ) ?? (output?.final ? "missing" : null);
    const { status, reasonCode } = statusFromTaskPart({
      state: part.state,
      output,
    });
    const workerType =
      asString(runtime?.workerType) ??
      asString(input.subagentType) ??
      "unknown";
    const workerId =
      asString(sharedWriterLease?.workerId) ??
      `${params.workflowRunId}:${parentToolCallId}`;
    const lifecycleEvent: DelegatedWorkerLifecycleEvent = {
      status,
      reasonCode,
      createdAt: now.toISOString(),
    };

    rows.push({
      id: `delegated-worker:${params.workflowRunId}:${parentToolCallId}`,
      sessionId: params.sessionId,
      chatId: params.chatId,
      userId: params.userId,
      workflowRunId: params.workflowRunId,
      parentToolCallId,
      parentWorkerRunId: null,
      workerId,
      workerType,
      taskTitle: asString(input.task),
      status,
      reasonCode,
      requestedWorkspacePolicy: asWorkspacePolicy(
        asString(workspacePolicy?.requestedPolicy) ??
          asString(workspaceResolution?.requestedPolicy),
      ),
      effectiveWorkspacePolicy: asWorkspacePolicy(
        asString(workspacePolicy?.effectivePolicy) ??
          asString(workspaceResolution?.effectivePolicy),
      ),
      workspaceMode: asWorkspaceMode(
        asString(workspacePolicy?.executionMode) ??
          asString(workspaceResolution?.decision),
      ),
      workspaceId:
        asString(isolatedWorkspace?.childWorkspaceId) ??
        asString(sharedWriterLease?.workspaceId) ??
        asString(workspaceResolution?.parentWorkspaceId),
      sourceWorkspaceId: asString(isolatedWorkspace?.parentWorkspaceId),
      sourceRef: asString(isolatedWorkspace?.sourceRef),
      sourceCommit: asString(isolatedWorkspace?.sourceCommit),
      childWorkspaceId: asString(isolatedWorkspace?.childWorkspaceId),
      childWorkspaceCreatedAt:
        typeof isolatedWorkspace?.createdAt === "number"
          ? new Date(isolatedWorkspace.createdAt)
          : null,
      sandboxName: asString(runtime?.sandboxName),
      managedRuntimeProfileId: asString(runtime?.profileId),
      managedRuntimeProfileVersion: asString(runtime?.profileVersion),
      managedRuntimeProfileRunId: asString(runtime?.profileRunId),
      evidenceRefs: buildEvidenceRefs(output),
      lifecycleEvents: [lifecycleEvent],
      completionPacket,
      completionPacketValidationStatus,
      completionPacketValidationReasonCode:
        asString(output?.completionPacketValidation?.reasonCode) ??
        (output?.final ? "worker_completion_packet_missing" : null),
      completionPacketValidationReason:
        asString(output?.completionPacketValidation?.reason) ??
        (output?.final
          ? "Completed worker did not include a completion packet."
          : null),
      startedAt: now,
      finishedAt: TERMINAL_STATUSES.has(status) ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return rows;
}

export async function recordDelegatedWorkerRunsFromMessage(params: {
  message: WebAgentUIMessage;
  workflowRunId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  now?: Date;
}): Promise<NewDelegatedWorkerRun[]> {
  const records = buildDelegatedWorkerRunRecordsFromMessage(params);

  for (const record of records) {
    await db
      .insert(delegatedWorkerRuns)
      .values(record)
      .onConflictDoUpdate({
        target: delegatedWorkerRuns.id,
        set: {
          status: record.status,
          reasonCode: record.reasonCode,
          workerId: record.workerId,
          workerType: record.workerType,
          taskTitle: record.taskTitle,
          requestedWorkspacePolicy: record.requestedWorkspacePolicy,
          effectiveWorkspacePolicy: record.effectiveWorkspacePolicy,
          workspaceMode: record.workspaceMode,
          workspaceId: record.workspaceId,
          sourceWorkspaceId: record.sourceWorkspaceId,
          sourceRef: record.sourceRef,
          sourceCommit: record.sourceCommit,
          childWorkspaceId: record.childWorkspaceId,
          childWorkspaceCreatedAt: record.childWorkspaceCreatedAt,
          sandboxName: record.sandboxName,
          managedRuntimeProfileId: record.managedRuntimeProfileId,
          managedRuntimeProfileVersion: record.managedRuntimeProfileVersion,
          managedRuntimeProfileRunId: record.managedRuntimeProfileRunId,
          evidenceRefs: record.evidenceRefs,
          lifecycleEvents: record.lifecycleEvents,
          completionPacket: record.completionPacket,
          completionPacketValidationStatus:
            record.completionPacketValidationStatus,
          completionPacketValidationReasonCode:
            record.completionPacketValidationReasonCode,
          completionPacketValidationReason:
            record.completionPacketValidationReason,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          updatedAt: record.updatedAt,
        },
      });
  }

  return records;
}

export async function listDelegatedWorkerRunsForSession(params: {
  sessionId: string;
  chatId?: string | null;
}): Promise<DelegatedWorkerRun[]> {
  const conditions = [eq(delegatedWorkerRuns.sessionId, params.sessionId)];
  if (params.chatId) {
    conditions.push(eq(delegatedWorkerRuns.chatId, params.chatId));
  }

  return db.query.delegatedWorkerRuns.findMany({
    where: and(...conditions),
    orderBy: [desc(delegatedWorkerRuns.createdAt)],
  });
}

export async function listDelegatedWorkerCompletionPacketsForSession(params: {
  sessionId: string;
  chatId?: string | null;
}): Promise<
  Array<{
    runId: string;
    workerId: string;
    workerType: string;
    status: DelegatedWorkerRunStatus;
    workspaceMode: "shared" | "isolated" | null;
    completionPacket: DelegatedWorkerRun["completionPacket"];
    validationStatus: DelegatedWorkerRun["completionPacketValidationStatus"];
    validationReasonCode: DelegatedWorkerRun["completionPacketValidationReasonCode"];
    validationReason: DelegatedWorkerRun["completionPacketValidationReason"];
    evidenceRefs: DelegatedWorkerRunEvidenceRef[];
  }>
> {
  const runs = await listDelegatedWorkerRunsForSession(params);
  return runs
    .filter(
      (run) =>
        run.completionPacket !== null ||
        run.completionPacketValidationStatus !== null,
    )
    .map((run) => ({
      runId: run.id,
      workerId: run.workerId,
      workerType: run.workerType,
      status: run.status,
      workspaceMode: run.workspaceMode,
      completionPacket: run.completionPacket,
      validationStatus: run.completionPacketValidationStatus,
      validationReasonCode: run.completionPacketValidationReasonCode,
      validationReason: run.completionPacketValidationReason,
      evidenceRefs: run.evidenceRefs,
    }));
}
