import {
  type AgentRunRouteContext,
  requireAgentApiRun,
} from "@/app/api/v1/agent-runs/[runId]/route";
import { compareAndSetChatActiveStreamId } from "@/lib/db/sessions";
import { agentApiRuns } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { getAgentRunSnapshot } from "@/lib/agent-api-runs/snapshots";
import { recordApiRunEvent } from "@/lib/agent-api-runs/runs";

const CANCELLABLE_STATUSES = ["accepted", "starting", "running"] as const;
type CancellableStatus = (typeof CANCELLABLE_STATUSES)[number];

function isCancellable(status: string): status is CancellableStatus {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

export async function POST(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:cancel"]);
  if (!result.ok) {
    return result.response;
  }

  // Guard: refuse to flip a terminal run.
  // completed/failed/cancelled runs must not be overwritten.
  if (!isCancellable(result.run.status)) {
    return Response.json(
      {
        error: "Run is already terminal",
        code: "already_terminal",
        status: result.run.status,
      },
      { status: 409 },
    );
  }

  if (!result.run.workflowRunId || !result.run.chatId) {
    return Response.json(
      { error: "Run has no active workflow to cancel" },
      { status: 409 },
    );
  }

  const { getRun } = await import("workflow/api");
  getRun(result.run.workflowRunId).cancel();
  await compareAndSetChatActiveStreamId(
    result.run.chatId,
    result.run.workflowRunId,
    null,
  );

  // Conditional update: only flip to cancelled if still in a non-terminal state
  // and has no finishedAt (prevents races with the workflow finalizer).
  const [updatedRun] = await db
    .update(agentApiRuns)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentApiRuns.id, result.run.id),
        inArray(agentApiRuns.status, [...CANCELLABLE_STATUSES]),
        isNull(agentApiRuns.finishedAt),
      ),
    )
    .returning();

  if (!updatedRun) {
    // Another process already finalized the run
    return Response.json(
      { error: "Run is already terminal", code: "already_terminal" },
      { status: 409 },
    );
  }

  if (result.run.sessionId) {
    await recordApiRunEvent({
      sessionId: result.run.sessionId,
      chatId: result.run.chatId,
      userId: result.run.userId,
      requestId: result.run.requestId,
      workflowRunId: result.run.workflowRunId,
      eventName: "agent_api.run.cancelled",
      status: "skipped",
      summary: "Agent API run cancellation was requested.",
      payload: { apiRunId: result.run.id },
    });
  }

  return Response.json({
    agentRun: await getAgentRunSnapshot(updatedRun),
  });
}
