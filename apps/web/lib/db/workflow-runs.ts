import { nanoid } from "nanoid";
import { db } from "./client";
import { workflowRuns, workflowRunSteps } from "./schema";

export type WorkflowRunStatus = "completed" | "aborted" | "failed";

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
