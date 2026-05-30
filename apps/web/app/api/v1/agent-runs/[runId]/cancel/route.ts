import {
  type AgentRunRouteContext,
  requireAgentApiRun,
} from "@/app/api/v1/agent-runs/[runId]/route";
import { compareAndSetChatActiveStreamId } from "@/lib/db/sessions";
import { agentApiRuns } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { getAgentRunSnapshot } from "@/lib/agent-api-runs/snapshots";
import { recordApiRunEvent } from "@/lib/agent-api-runs/runs";

export async function POST(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:cancel"]);
  if (!result.ok) {
    return result.response;
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
  const [updatedRun] = await db
    .update(agentApiRuns)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentApiRuns.id, result.run.id))
    .returning();

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
    agentRun: await getAgentRunSnapshot(updatedRun ?? result.run),
  });
}
