import "server-only";

import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { mergeEventsForSummary } from "@/app/api/agent-loop-runs/[runId]/_lib/merge-events-for-summary";
import type { BackgroundRunDetailData } from "@/app/background-runs/[runId]/types";
import {
  getOwnedAgentLoopRunWithLoop,
  listAgentLoopComposioEvents,
  listAgentLoopEvents,
  listStepRunsForRun,
  listWatchdogRunsForLoopRun,
} from "@/lib/agent-loops/store";
import {
  getOwnedBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
} from "@/lib/background-agents/store";
import {
  getBackgroundAgentSnapshotSource,
  toSafeBackgroundAgentEvidence,
} from "@/lib/background-agents/public-run";
import {
  toPublicAgentLoopRun,
  toSafeAgentLoopEvidence,
} from "@/lib/agent-loops/public-run";

type OwnedRunParams = {
  userId: string;
  runId: string;
};

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function loadOwnedBackgroundRunDetail({
  userId,
  runId,
}: OwnedRunParams): Promise<BackgroundRunDetailData | null> {
  const row = await getOwnedBackgroundAgentRunWithAgent({ userId, runId });
  if (!row) return null;

  const { run, agent } = row;
  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  return {
    run: {
      id: run.id,
      status: run.status,
      source: run.source,
      triggerId: run.triggerId,
      triggerKind: run.triggerKind,
      externalId: run.externalId,
      idempotencyKey: run.idempotencyKey,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
      ref: run.ref,
      sha: run.sha,
      branch: run.branch,
      prNumber: run.prNumber,
      issueNumber: run.issueNumber,
      deploymentUrl: run.deploymentUrl,
      outputUrl: run.outputUrl,
      sandboxName: run.sandboxName,
      requestId: run.requestId,
      workflowRunId: run.workflowRunId,
      errorKind: run.errorKind,
      errorMessage: run.errorMessage,
      resultSummary: run.resultSummary ?? null,
      definitionVersion: run.definitionVersion,
      definitionHash: run.definitionHash,
      snapshotSource: getBackgroundAgentSnapshotSource(run),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      startedAt: serializeDate(run.startedAt),
      finishedAt: serializeDate(run.finishedAt),
    },
    agent: toSafeBackgroundAgentEvidence(run, agent),
    events: events.map((event) => ({
      id: event.id,
      eventName: event.eventName,
      status: event.status,
      summary: event.summary,
      workflowRunId: event.workflowRunId,
      sandboxName: event.sandboxName,
      requestId: event.requestId,
      errorKind: event.errorKind,
      redactionStatus: event.redactionStatus,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
      sequence: event.sequence,
    })),
    outputs: outputs.map((output) => ({
      id: output.id,
      kind: output.kind,
      status: output.status,
      url: output.url,
      prNumber: output.prNumber,
    })),
  };
}

export async function loadOwnedLoopRunDetail({
  userId,
  runId,
}: OwnedRunParams): Promise<GetAgentLoopRunDetailResponse | null> {
  const row = await getOwnedAgentLoopRunWithLoop({ userId, runId });
  if (!row) return null;

  const [steps, cappedEvents, composioEvents, watchdogRuns] = await Promise.all(
    [
      listStepRunsForRun(runId),
      listAgentLoopEvents(runId),
      listAgentLoopComposioEvents(runId),
      listWatchdogRunsForLoopRun(runId),
    ],
  );
  const safeLoop = toSafeAgentLoopEvidence(row.run, row.loop);

  return {
    run: toPublicAgentLoopRun(row.run),
    loop: safeLoop
      ? {
          id: safeLoop.id,
          name: safeLoop.name,
          repoOwner: safeLoop.repoOwner,
          repoName: safeLoop.repoName,
          guardrails: safeLoop.guardrails,
          sourceDeleted: safeLoop.sourceDeleted,
          sourceActive: safeLoop.sourceActive,
        }
      : null,
    steps,
    events: mergeEventsForSummary(cappedEvents, composioEvents),
    watchdogRuns,
  };
}
