import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  verifiedBuildEvents,
  verifiedBuildRuns,
  type VerifiedBuildEvent,
  type VerifiedBuildRun,
} from "@/lib/db/schema";
import type { HarnessClient } from "./client";
import { getHarnessConfig } from "./config";
import { reduceHarnessEvent } from "./events";
import { redactHarnessPayload } from "./redaction";
import type {
  HarnessMode,
  HarnessRequestContext,
  StartVerifiedBuildInput,
  VerifiedBuildEventSnapshot,
  VerifiedBuildRunSnapshot,
} from "./types";

export function buildVerifiedBuildIdempotencyKey(params: {
  sessionId: string;
  chatId: string;
  latestUserMessageId: string;
  action: string;
}): string {
  return [
    "open-agents",
    params.sessionId,
    params.chatId,
    params.latestUserMessageId,
    params.action,
  ].join(":");
}

export function hashIdempotencyKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex");
}

export function toVerifiedBuildRunSnapshot(
  run: VerifiedBuildRun,
): VerifiedBuildRunSnapshot {
  return {
    id: run.id,
    sessionId: run.sessionId,
    chatId: run.chatId,
    harnessRunId: run.harnessRunId,
    mode: run.mode,
    status: run.status,
    tenantId: run.tenantId,
    projectId: run.projectId,
    actorId: run.actorId,
    intentSummary: run.intentSummary,
    selectionReason: run.selectionReason,
    lastEventId: run.lastEventId,
    lastEventName: run.lastEventName,
    lastEventAt: run.lastEventAt,
    planApprovalState: run.planApprovalState,
    pendingApprovalKind: run.pendingApprovalKind,
    finalReportArtifactId: run.finalReportArtifactId,
    goNoGo: run.goNoGo,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function toVerifiedBuildEventSnapshot(
  event: VerifiedBuildEvent,
): VerifiedBuildEventSnapshot {
  return {
    id: event.id,
    verifiedBuildRunId: event.verifiedBuildRunId,
    harnessEventId: event.harnessEventId,
    eventName: event.eventName,
    eventPayload: event.eventPayload,
    eventAt: event.eventAt,
    receivedAt: event.receivedAt,
    requestId: event.requestId,
  };
}

export async function getVerifiedBuildRunByIdForUser(params: {
  runId: string;
  userId: string;
}): Promise<VerifiedBuildRun | null> {
  return (
    (await db.query.verifiedBuildRuns.findFirst({
      where: and(
        eq(verifiedBuildRuns.id, params.runId),
        eq(verifiedBuildRuns.userId, params.userId),
      ),
    })) ?? null
  );
}

export async function getLatestVerifiedBuildRunForChat(params: {
  sessionId: string;
  chatId: string;
  userId: string;
}): Promise<VerifiedBuildRun | null> {
  return (
    (await db.query.verifiedBuildRuns.findFirst({
      where: and(
        eq(verifiedBuildRuns.sessionId, params.sessionId),
        eq(verifiedBuildRuns.chatId, params.chatId),
        eq(verifiedBuildRuns.userId, params.userId),
      ),
      orderBy: [desc(verifiedBuildRuns.updatedAt)],
    })) ?? null
  );
}

export async function getVerifiedBuildEventsForRun(
  verifiedBuildRunId: string,
): Promise<VerifiedBuildEvent[]> {
  return db.query.verifiedBuildEvents.findMany({
    where: eq(verifiedBuildEvents.verifiedBuildRunId, verifiedBuildRunId),
    orderBy: [verifiedBuildEvents.receivedAt],
  });
}

export async function getVerifiedBuildRunByIdempotency(params: {
  tenantId: string;
  projectId?: string | null;
  actorId: string;
  idempotencyKey: string;
}): Promise<VerifiedBuildRun | null> {
  return (
    (await db.query.verifiedBuildRuns.findFirst({
      where: and(
        eq(verifiedBuildRuns.tenantId, params.tenantId),
        eq(verifiedBuildRuns.projectId, params.projectId ?? ""),
        eq(verifiedBuildRuns.actorId, params.actorId),
        eq(verifiedBuildRuns.idempotencyKey, params.idempotencyKey),
      ),
    })) ?? null
  );
}

export function buildHarnessRunBody(input: StartVerifiedBuildInput): {
  mode: HarnessMode;
  intent: {
    summary: string;
    session_id: string;
    chat_id: string;
    latest_user_message_id: string;
  };
  open_agents: {
    session_id: string;
    chat_id: string;
    user_id: string;
    selection_reason?: string;
  };
} {
  return {
    mode: input.mode,
    intent: {
      summary:
        input.intentSummary ?? "Verified Build requested from Open Agents",
      session_id: input.sessionId,
      chat_id: input.chatId,
      latest_user_message_id: input.latestUserMessageId,
    },
    open_agents: {
      session_id: input.sessionId,
      chat_id: input.chatId,
      user_id: input.userId,
      ...(input.selectionReason
        ? { selection_reason: input.selectionReason }
        : {}),
    },
  };
}

export async function startVerifiedBuildRun(params: {
  input: StartVerifiedBuildInput;
  client: HarnessClient;
}): Promise<VerifiedBuildRun> {
  const config = getHarnessConfig();
  if (!config.enabled) {
    throw new Error("Verified Build harness is disabled");
  }

  const context: HarnessRequestContext = {
    requestId: params.input.requestId,
    tenantId: config.tenantId,
    projectId: config.defaultProjectId ?? "",
    actorId: params.input.userId,
  };
  const idempotencyKey = buildVerifiedBuildIdempotencyKey({
    sessionId: params.input.sessionId,
    chatId: params.input.chatId,
    latestUserMessageId: params.input.latestUserMessageId,
    action: params.input.mode,
  });

  const existing = await getVerifiedBuildRunByIdempotency({
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorId: context.actorId,
    idempotencyKey,
  });
  if (existing) {
    return existing;
  }

  const harnessRun = await params.client.createRun({
    context,
    idempotencyKey,
    body: buildHarnessRunBody(params.input),
  });
  const harnessRunId = harnessRun.run_id ?? harnessRun.id;
  if (!harnessRunId) {
    throw new Error("Harness did not return a run id");
  }

  const [run] = await db
    .insert(verifiedBuildRuns)
    .values({
      id: nanoid(),
      sessionId: params.input.sessionId,
      chatId: params.input.chatId,
      userId: params.input.userId,
      harnessRunId,
      mode: harnessRun.mode ?? params.input.mode,
      status: harnessRun.status ?? "accepted",
      tenantId: context.tenantId,
      projectId: context.projectId,
      actorId: context.actorId,
      idempotencyKey,
      intentSummary: params.input.intentSummary ?? null,
      selectionReason: params.input.selectionReason ?? null,
      planApprovalState: harnessRun.plan_approval_state ?? "not_required",
      pendingApprovalKind: harnessRun.pending_approval_kind ?? null,
      finalReportArtifactId: harnessRun.final_report_artifact_id ?? null,
      goNoGo: harnessRun.go_no_go ?? "unknown",
    })
    .returning();

  if (!run) {
    throw new Error("Failed to persist Verified Build run mapping");
  }

  return run;
}

export async function updateVerifiedBuildRunFromHarnessStatus(params: {
  runId: string;
  status?: string;
  planApprovalState?: VerifiedBuildRun["planApprovalState"];
  pendingApprovalKind?: string | null;
  finalReportArtifactId?: string | null;
  goNoGo?: VerifiedBuildRun["goNoGo"];
}): Promise<void> {
  const patch: Partial<typeof verifiedBuildRuns.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (params.status) patch.status = params.status;
  if (params.planApprovalState)
    patch.planApprovalState = params.planApprovalState;
  if (params.pendingApprovalKind !== undefined) {
    patch.pendingApprovalKind = params.pendingApprovalKind;
  }
  if (params.finalReportArtifactId !== undefined) {
    patch.finalReportArtifactId = params.finalReportArtifactId;
  }
  if (params.goNoGo) patch.goNoGo = params.goNoGo;

  await db
    .update(verifiedBuildRuns)
    .set(patch)
    .where(eq(verifiedBuildRuns.id, params.runId));
}

export async function persistVerifiedBuildEvent(params: {
  verifiedBuildRunId: string;
  harnessEventId: string;
  eventName: string;
  eventPayload: unknown;
  eventAt?: Date | null;
  requestId?: string | null;
}): Promise<void> {
  const redactedPayload = redactHarnessPayload(params.eventPayload);
  await db
    .insert(verifiedBuildEvents)
    .values({
      id: nanoid(),
      verifiedBuildRunId: params.verifiedBuildRunId,
      harnessEventId: params.harnessEventId,
      eventName: params.eventName,
      eventPayload: redactedPayload,
      eventAt: params.eventAt ?? null,
      requestId: params.requestId ?? null,
    })
    .onConflictDoNothing({
      target: [
        verifiedBuildEvents.verifiedBuildRunId,
        verifiedBuildEvents.harnessEventId,
      ],
    });

  const reduction = reduceHarnessEvent(params.eventName, redactedPayload);
  await db
    .update(verifiedBuildRuns)
    .set({
      ...reduction,
      lastEventId: params.harnessEventId,
      lastEventName: params.eventName,
      lastEventAt: params.eventAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(verifiedBuildRuns.id, params.verifiedBuildRunId));
}
