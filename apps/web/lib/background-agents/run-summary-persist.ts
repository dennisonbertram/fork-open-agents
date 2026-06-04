/**
 * Server-side persistence helpers for durable run summaries (#163).
 * Intentionally split from run-summary.ts so the pure builder can be
 * imported and tested without server-only restrictions.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { backgroundAgentRuns } from "@/lib/db/schema";
import { recordBackgroundAgentEvent } from "./store";
import type { RunSummary } from "./run-summary";

export type { RunSummary } from "./run-summary";

type PersistRunSummaryParams = {
  runId: string;
  summary: RunSummary;
};

/**
 * Writes the run summary to the background_agent_runs table.
 * Must be called inside a try/catch in the terminal executor path so that
 * summary generation failures never change the run status.
 */
export async function persistRunSummary(
  params: PersistRunSummaryParams,
): Promise<void> {
  await db
    .update(backgroundAgentRuns)
    .set({ resultSummary: params.summary })
    .where(eq(backgroundAgentRuns.id, params.runId));
}

/**
 * Records a summary_failed event. Called from the catch block that wraps
 * summary generation so the run's true terminal status is preserved.
 */
export async function recordSummaryFailedEvent(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  error: unknown;
}): Promise<void> {
  await recordBackgroundAgentEvent({
    runId: params.runId,
    agentId: params.agentId,
    userId: params.userId,
    eventName: "background-agent.summary_failed",
    status: "failed",
    level: "warn",
    summary: "Run summary generation failed; run status is unaffected.",
    errorKind: "summary_failed",
    payload: {
      error:
        params.error instanceof Error ? params.error.message : "Unknown error",
    },
  });
}
