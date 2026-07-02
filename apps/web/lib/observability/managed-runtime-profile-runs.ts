import "server-only";

import type {
  ManagedRuntimeProfile,
  ManagedRuntimeProfileCommand,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  type ManagedRuntimeCommandObservation,
  type ManagedRuntimeProfileRun,
  managedRuntimeProfileRuns,
} from "@/lib/db/schema";
import { redactHarnessValue } from "@/lib/harness/redaction";
import { redactSandboxLog } from "@/lib/sandbox/runtime/service-logs";

type CommandResultLike = {
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
};

export type ManagedRuntimeProfileRunSnapshot = Omit<
  ManagedRuntimeProfileRun,
  "startedAt" | "finishedAt" | "createdAt" | "updatedAt"
> & {
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function summarizeManagedRuntimeCommandOutput(
  result: CommandResultLike,
): string {
  const combined = [result.stderr, result.stdout]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
  const redacted = String(
    redactHarnessValue(redactSandboxLog(combined), "summary"),
  ).trim();

  if (redacted.length === 0) {
    return result.success
      ? "Command completed without output."
      : "Command failed without output.";
  }

  return redacted.slice(0, 2000);
}

export function buildManagedRuntimeCommandObservation(params: {
  command: ManagedRuntimeProfileCommand;
  status: ManagedRuntimeCommandObservation["status"];
  startedAt: Date;
  finishedAt?: Date;
  result?: CommandResultLike;
}): ManagedRuntimeCommandObservation {
  return {
    commandId: params.command.id,
    label: params.command.label,
    status: params.status,
    required: params.command.required ?? true,
    exitCode: params.result?.exitCode ?? null,
    durationMs: params.finishedAt
      ? params.finishedAt.getTime() - params.startedAt.getTime()
      : undefined,
    summary: params.result
      ? summarizeManagedRuntimeCommandOutput(params.result)
      : undefined,
    startedAt: params.startedAt.toISOString(),
    finishedAt: params.finishedAt?.toISOString(),
  };
}

export function toManagedRuntimeProfileRunSnapshot(
  run: ManagedRuntimeProfileRun,
): ManagedRuntimeProfileRunSnapshot {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export async function startManagedRuntimeProfileRun(params: {
  sessionId: string;
  chatId?: string | null;
  userId: string;
  workflowRunId?: string | null;
  sandboxName?: string | null;
  profile: ManagedRuntimeProfile;
  requestedProfileId?: string | null;
  resolvedProfileId?: string | null;
}): Promise<ManagedRuntimeProfileRun> {
  const now = new Date();
  const [run] = await db
    .insert(managedRuntimeProfileRuns)
    .values({
      id: nanoid(),
      sessionId: params.sessionId,
      chatId: params.chatId ?? null,
      userId: params.userId,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      profileId: params.profile.id,
      profileVersion: params.profile.version,
      profileDisplayName: params.profile.displayName,
      requestedProfileId: params.requestedProfileId ?? params.profile.id,
      resolvedProfileId: params.resolvedProfileId ?? params.profile.id,
      status: "running",
      expectedTools: [...params.profile.expectedTools],
      optionalTools: [...params.profile.optionalTools],
      setupResults: [],
      verificationResults: [],
      summary: null,
      failureMessage: null,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create managed runtime profile run");
  }

  return run;
}

export async function appendManagedRuntimeSetupResult(params: {
  profileRunId: string;
  observation: ManagedRuntimeCommandObservation;
}): Promise<ManagedRuntimeProfileRun> {
  const current = await db.query.managedRuntimeProfileRuns.findFirst({
    where: eq(managedRuntimeProfileRuns.id, params.profileRunId),
  });
  if (!current) {
    throw new Error("Managed runtime profile run not found");
  }

  const [updated] = await db
    .update(managedRuntimeProfileRuns)
    .set({
      setupResults: [...current.setupResults, params.observation],
      updatedAt: new Date(),
    })
    .where(eq(managedRuntimeProfileRuns.id, params.profileRunId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update managed runtime profile run");
  }

  return updated;
}

export async function appendManagedRuntimeVerificationResult(params: {
  profileRunId: string;
  observation: ManagedRuntimeCommandObservation;
}): Promise<ManagedRuntimeProfileRun> {
  const current = await db.query.managedRuntimeProfileRuns.findFirst({
    where: eq(managedRuntimeProfileRuns.id, params.profileRunId),
  });
  if (!current) {
    throw new Error("Managed runtime profile run not found");
  }

  const [updated] = await db
    .update(managedRuntimeProfileRuns)
    .set({
      verificationResults: [...current.verificationResults, params.observation],
      updatedAt: new Date(),
    })
    .where(eq(managedRuntimeProfileRuns.id, params.profileRunId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update managed runtime profile run");
  }

  return updated;
}

export async function finishManagedRuntimeProfileRun(params: {
  profileRunId: string;
  status: ManagedRuntimeProfileRun["status"];
  summary?: string | null;
  failureMessage?: string | null;
  errorKind?: ManagedRuntimeProfileRun["errorKind"];
  nextAction?: string | null;
}): Promise<ManagedRuntimeProfileRun> {
  const now = new Date();
  const [updated] = await db
    .update(managedRuntimeProfileRuns)
    .set({
      status: params.status,
      summary: params.summary ?? null,
      failureMessage: params.failureMessage ?? null,
      errorKind: params.errorKind ?? null,
      nextAction: params.nextAction ?? null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(managedRuntimeProfileRuns.id, params.profileRunId))
    .returning();

  if (!updated) {
    throw new Error("Failed to finish managed runtime profile run");
  }

  return updated;
}

export async function listManagedRuntimeProfileRuns(params: {
  sessionId: string;
  chatId?: string | null;
  limit?: number;
}): Promise<ManagedRuntimeProfileRun[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const where =
    params.chatId == null
      ? eq(managedRuntimeProfileRuns.sessionId, params.sessionId)
      : and(
          eq(managedRuntimeProfileRuns.sessionId, params.sessionId),
          or(
            eq(managedRuntimeProfileRuns.chatId, params.chatId),
            isNull(managedRuntimeProfileRuns.chatId),
          ),
        );

  return db.query.managedRuntimeProfileRuns.findMany({
    where,
    orderBy: [desc(managedRuntimeProfileRuns.createdAt)],
    limit,
  });
}
