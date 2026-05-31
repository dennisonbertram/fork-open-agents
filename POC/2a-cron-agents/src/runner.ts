/**
 * Job runner: materializes a session + chat for a due job, claims an
 * idempotent run row, invokes the agent seam, and records the outcome.
 *
 * Maps onto the real app as follows:
 *   - createSessionWithInitialChat  ->  apps/web/lib/db/sessions.ts
 *   - persist user (prompt) message ->  persistUserMessage in chat-post-finish
 *   - runAgent seam                 ->  start(runAgentWorkflow, [...])
 *   - scheduled_job_runs row        ->  new table (mirrors workflowRuns audit)
 */
import { and, eq } from "drizzle-orm";
import { nextRunAfter, scheduledTickFor } from "./cron";
import {
  chats,
  scheduledJobRuns,
  scheduledJobs,
  sessions,
  type ScheduledJob,
} from "./schema";
import type { Db } from "./db";
import type { RunAgent } from "./agent-seam";

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export type DispatchOutcome =
  | { jobId: string; status: "succeeded"; runId: string; chatId: string; prUrl?: string }
  | { jobId: string; status: "failed"; runId: string; error: string }
  | { jobId: string; status: "skipped"; reason: "already-dispatched" | "in-flight" };

/**
 * Try to claim an idempotent run slot for (job, scheduled tick). The unique
 * index on (job_id, scheduled_for) guarantees that two concurrent cron
 * invocations targeting the same scheduled minute cannot both insert — the
 * loser gets a constraint violation and the job is skipped, preventing
 * double-dispatch and overlap.
 *
 * Returns the new run id, or null if a run for this tick already exists
 * (in-flight or finished).
 */
function claimRun(db: Db, jobId: string, scheduledFor: Date): string | null {
  // Pre-check for a friendlier skip reason; the unique index is the real guard.
  const existing = db
    .select({ id: scheduledJobRuns.id })
    .from(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.jobId, jobId),
        eq(scheduledJobRuns.scheduledFor, scheduledFor),
      ),
    )
    .get();
  if (existing) {
    return null;
  }

  const runId = id("run");
  try {
    db.insert(scheduledJobRuns)
      .values({
        id: runId,
        jobId,
        status: "running",
        scheduledFor,
        startedAt: new Date(),
      })
      .run();
    return runId;
  } catch (err) {
    // Unique constraint race: another invocation won the slot.
    if (String(err).includes("UNIQUE")) {
      return null;
    }
    throw err;
  }
}

/**
 * Run a single due job. Idempotent per scheduled tick.
 */
export async function runJob(
  db: Db,
  job: ScheduledJob,
  now: Date,
  runAgent: RunAgent,
): Promise<DispatchOutcome> {
  const tick = scheduledTickFor(job.cronExpression, now);
  const runId = claimRun(db, job.id, tick);
  if (!runId) {
    return { jobId: job.id, status: "skipped", reason: "already-dispatched" };
  }

  // Materialize a fresh session + chat for this run (standing agents create a
  // new session per fire, like a webhook-triggered background agent does).
  const sessionId = id("ses");
  const chatId = id("chat");
  db.insert(sessions)
    .values({
      id: sessionId,
      userId: job.ownerUserId,
      title: `Scheduled: ${job.repoOwner}/${job.repoName}`,
      status: "running",
      repoOwner: job.repoOwner,
      repoName: job.repoName,
      branch: job.branch,
    })
    .run();
  db.insert(chats)
    .values({ id: chatId, sessionId, title: "Scheduled run" })
    .run();

  try {
    const result = await runAgent({
      messages: [{ role: "user", parts: [{ type: "text", text: job.prompt }] }],
      chatId,
      sessionId,
      userId: job.ownerUserId,
      repoOwner: job.repoOwner,
      repoName: job.repoName,
      branch: job.branch,
      requestId: runId,
      maxSteps: 500,
    });

    db.update(scheduledJobRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        resultChatId: result.chatId,
        prUrl: result.prUrl ?? null,
      })
      .where(eq(scheduledJobRuns.id, runId))
      .run();

    advanceSchedule(db, job, now);
    return {
      jobId: job.id,
      status: "succeeded",
      runId,
      chatId: result.chatId,
      prUrl: result.prUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(scheduledJobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(scheduledJobRuns.id, runId))
      .run();
    // Still advance the schedule so a single failure does not wedge the job
    // on the same tick forever.
    advanceSchedule(db, job, now);
    return { jobId: job.id, status: "failed", runId, error: message };
  }
}

function advanceSchedule(db: Db, job: ScheduledJob, now: Date): void {
  db.update(scheduledJobs)
    .set({
      lastRunAt: now,
      nextRunAt: nextRunAfter(job.cronExpression, now),
    })
    .where(eq(scheduledJobs.id, job.id))
    .run();
}
