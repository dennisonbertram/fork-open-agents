import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
// #1241: the type and the pure mapping function live in lib/chat — that
// module must stay free of `lib/db/` imports so app/workflows/chat.ts (which
// runs inside the workflow VM) can import the function without dragging
// `postgres`/`nanoid` into the workflow bundle. Re-exported here so every
// existing importer of these two names from this module keeps working.
import {
  deriveWorkflowRunOutcomeStatus,
  type WorkflowRunStatus,
} from "@/lib/chat/workflow-run-outcome";
import { db } from "./client";
import { workflowRuns, workflowRunSteps } from "./schema";

export { deriveWorkflowRunOutcomeStatus };
export type { WorkflowRunStatus };

/**
 * The most recent run's raw status for a session, or null if the session has
 * never had a run recorded. Backs get_session's `lastRunOutcome` only — never
 * list_sessions, so this single indexed lookup (`workflow_runs_session_id_idx`)
 * never becomes an N+1 across a page of sessions.
 */
export async function getLatestWorkflowRunStatusBySessionId(
  sessionId: string,
): Promise<string | null> {
  const [run] = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.sessionId, sessionId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(1);

  return run?.status ?? null;
}

export type WorkflowRunStepTiming = {
  stepNumber: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finishReason?: string;
  rawFinishReason?: string;
};

export async function recordWorkflowRun(data: {
  id: string;
  chatId: string;
  sessionId: string;
  userId: string;
  modelId?: string;
  inferenceRoute?: "gateway" | "user" | null;
  inferenceProfileId?: string | null;
  requestId?: string | null;
  runtimeMode?: "classic" | "managed_runtime" | null;
  sandboxName?: string | null;
  managedRuntimeProfileId?: string | null;
  managedRuntimeProfileVersion?: string | null;
  managedRuntimeProfileRunId?: string | null;
  errorMessage?: string | null;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stepTimings: WorkflowRunStepTiming[];
}) {
  await db.transaction(async (tx) => {
    await tx
      .insert(workflowRuns)
      .values({
        id: data.id,
        chatId: data.chatId,
        sessionId: data.sessionId,
        userId: data.userId,
        modelId: data.modelId ?? null,
        inferenceRoute: data.inferenceRoute ?? null,
        inferenceProfileId: data.inferenceProfileId ?? null,
        requestId: data.requestId ?? null,
        runtimeMode: data.runtimeMode ?? null,
        sandboxName: data.sandboxName ?? null,
        managedRuntimeProfileId: data.managedRuntimeProfileId ?? null,
        managedRuntimeProfileVersion: data.managedRuntimeProfileVersion ?? null,
        managedRuntimeProfileRunId: data.managedRuntimeProfileRunId ?? null,
        errorMessage: data.errorMessage ?? null,
        status: data.status,
        startedAt: new Date(data.startedAt),
        finishedAt: new Date(data.finishedAt),
        totalDurationMs: data.totalDurationMs,
      })
      .onConflictDoNothing({ target: workflowRuns.id });

    if (data.stepTimings.length === 0) {
      return;
    }

    await tx
      .insert(workflowRunSteps)
      .values(
        data.stepTimings.map((stepTiming) => ({
          id: nanoid(),
          workflowRunId: data.id,
          stepNumber: stepTiming.stepNumber,
          startedAt: new Date(stepTiming.startedAt),
          finishedAt: new Date(stepTiming.finishedAt),
          durationMs: stepTiming.durationMs,
          finishReason: stepTiming.finishReason ?? null,
          rawFinishReason: stepTiming.rawFinishReason ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [workflowRunSteps.workflowRunId, workflowRunSteps.stepNumber],
      });
  });
}
