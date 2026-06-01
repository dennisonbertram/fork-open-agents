import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  type ManagedRuntimeWorkerRun,
  managedRuntimeWorkerRuns,
} from "@/lib/db/schema";
import { redactHarnessValue } from "@/lib/harness/redaction";
import type { ManagedRuntimeWorkerSnapshot } from "./managed-runtime-workers";

export type RecordManagedRuntimeWorkerRunInput = {
  sessionId: string;
  chatId: string | null;
  userId: string;
  workflowRunId: string | null;
  taskToolCallId: string;
  workerType: string;
  status: ManagedRuntimeWorkerRun["status"];
  sandboxName: string | null;
  profileId: string | null;
  profileVersion: string | null;
  profileDisplayName: string | null;
  profileRunId: string | null;
  toolCallCount: number;
  // Will be redacted before persisting
  summary: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/**
 * Upsert a managed-runtime worker run record.
 *
 * Dedup key: (sessionId, taskToolCallId) — subsequent calls update the row
 * in place (status, summary, counts, timestamps).
 *
 * summary is redacted via redactHarnessValue before being written to the DB.
 */
export async function recordManagedRuntimeWorkerRun(
  input: RecordManagedRuntimeWorkerRunInput,
): Promise<ManagedRuntimeWorkerRun> {
  const now = new Date();
  const redactedSummary = input.summary
    ? String(redactHarnessValue(input.summary, "summary"))
    : null;

  const [row] = await db
    .insert(managedRuntimeWorkerRuns)
    .values({
      id: nanoid(),
      sessionId: input.sessionId,
      chatId: input.chatId ?? null,
      userId: input.userId,
      workflowRunId: input.workflowRunId ?? null,
      taskToolCallId: input.taskToolCallId,
      workerType: input.workerType,
      status: input.status,
      sandboxName: input.sandboxName ?? null,
      profileId: input.profileId ?? null,
      profileVersion: input.profileVersion ?? null,
      profileDisplayName: input.profileDisplayName ?? null,
      profileRunId: input.profileRunId ?? null,
      toolCallCount: input.toolCallCount,
      summary: redactedSummary,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        managedRuntimeWorkerRuns.sessionId,
        managedRuntimeWorkerRuns.taskToolCallId,
      ],
      set: {
        chatId: input.chatId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        workerType: input.workerType,
        status: input.status,
        sandboxName: input.sandboxName ?? null,
        profileId: input.profileId ?? null,
        profileVersion: input.profileVersion ?? null,
        profileDisplayName: input.profileDisplayName ?? null,
        profileRunId: input.profileRunId ?? null,
        toolCallCount: input.toolCallCount,
        summary: redactedSummary,
        startedAt: input.startedAt ?? null,
        finishedAt: input.finishedAt ?? null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to upsert managed runtime worker run");
  }

  return row;
}

/**
 * Best-effort wrapper for recordManagedRuntimeWorkerRun.
 *
 * Used at chat workflow write points where a persistence failure MUST NOT
 * crash the workflow. Swallows all errors and returns void.
 */
export async function persistWorkerRunBestEffort(
  input: RecordManagedRuntimeWorkerRunInput,
): Promise<void> {
  try {
    await recordManagedRuntimeWorkerRun(input);
  } catch {
    // Intentionally swallowed — persistence is best-effort and must never
    // interrupt the chat workflow.
  }
}

/**
 * List all durable worker run rows for a session, ordered by createdAt asc.
 */
export async function listManagedRuntimeWorkerRunsForSession(
  sessionId: string,
): Promise<ManagedRuntimeWorkerRun[]> {
  return db.query.managedRuntimeWorkerRuns.findMany({
    where: eq(managedRuntimeWorkerRuns.sessionId, sessionId),
    orderBy: [asc(managedRuntimeWorkerRuns.createdAt)],
  });
}

/**
 * Map a durable DB row to a ManagedRuntimeWorkerSnapshot.
 *
 * source is always "durable" to distinguish from message-derived snapshots.
 * Timestamps are converted to ISO strings.
 * currentToolName / currentToolSummary are not stored durably (they reflect
 * in-flight tool state) and are returned as null.
 */
export function toManagedRuntimeWorkerSnapshot(
  row: ManagedRuntimeWorkerRun,
): ManagedRuntimeWorkerSnapshot {
  return {
    id: row.taskToolCallId,
    source: "durable",
    taskToolCallId: row.taskToolCallId,
    workerType: row.workerType,
    status: row.status,
    sandboxName: row.sandboxName ?? null,
    profileId: row.profileId ?? null,
    profileVersion: row.profileVersion ?? null,
    profileDisplayName: row.profileDisplayName ?? null,
    profileRunId: row.profileRunId ?? null,
    // In-flight tool state is not stored durably
    currentToolName: null,
    currentToolSummary: null,
    toolCallCount: row.toolCallCount,
    summary: row.summary ?? null,
    // Use updatedAt as the snapshot timestamp (matches message-derived behaviour)
    updatedAt: row.updatedAt.toISOString(),
  };
}
