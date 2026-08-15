import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
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
import { sessions, workflowRuns, workflowRunSteps } from "./schema";

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

/**
 * A finished workflow run joined to its session's summary columns — the row
 * shape open_agents_get_updates (#1270) reads. `workflowRuns` is the source of
 * truth for "a run ended": it is written ONCE at the true end of a run, unlike
 * `session_events` which fire throughout a run and would report activity, not
 * completion.
 *
 * `totalCount` is each row's COUNT(*) OVER() — the number of runs in the whole
 * window (not just this limited page), so a caller can tell the difference
 * between "only these finished" and "these finished and more did but the cap cut
 * them off" instead of silently missing finishes.
 */
export type FinishedWorkflowRun = {
  runId: string;
  sessionId: string;
  /** Raw `workflow_runs.status`; mapped to the MCP `lastRunOutcome` vocabulary
   * at the read boundary (toLastRunOutcome). */
  status: string;
  finishedAt: Date;
  title: string;
  label: string | null;
  branch: string | null;
  baseBranch: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  totalCount: number;
};

/**
 * The runs belonging to `userId` whose `finishedAt` is strictly after `since`,
 * oldest-finish-first, capped at `limit`. Optional `label` narrows the window
 * to sessions sharing that exact batch tag. Ownership is enforced here, at the
 * query boundary, by the `userId` filter — another user's runs can never appear
 * because they never match the WHERE clause.
 *
 * Ascending order is deliberate: within a fan-out batch the earliest finishes
 * are the ones a client most wants to confirm before the later ones, and each
 * poll's `since` (the server's own "as of" cursor, strictly later than the last
 * poll) means an ascending page never re-reports work already acknowledged while
 * a descending page could. `totalCount` still carries the full window size.
 */
export async function getWorkflowRunsFinishedSince(input: {
  userId: string;
  since: Date;
  label?: string;
  limit: number;
}): Promise<FinishedWorkflowRun[]> {
  return db
    .select({
      runId: workflowRuns.id,
      sessionId: workflowRuns.sessionId,
      status: workflowRuns.status,
      finishedAt: workflowRuns.finishedAt,
      title: sessions.title,
      label: sessions.label,
      branch: sessions.branch,
      baseBranch: sessions.baseBranch,
      prNumber: sessions.prNumber,
      prStatus: sessions.prStatus,
      totalCount: sql<number>`COUNT(*) OVER ()::int`,
    })
    .from(workflowRuns)
    .innerJoin(sessions, eq(sessions.id, workflowRuns.sessionId))
    .where(
      and(
        eq(workflowRuns.userId, input.userId),
        gt(workflowRuns.finishedAt, input.since),
        input.label ? eq(sessions.label, input.label) : undefined,
      ),
    )
    .orderBy(asc(workflowRuns.finishedAt))
    .limit(input.limit);
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
