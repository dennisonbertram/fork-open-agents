import {
  type AgentRunRouteContext,
  requireAgentApiRun,
} from "@/app/api/v1/agent-runs/[runId]/route";
import { listEventsQuerySchema } from "@/lib/agent-api-runs/schemas";
import { listAgentRunEvents } from "@/lib/agent-api-runs/snapshots";

export async function GET(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:read"]);
  if (!result.ok) {
    return result.response;
  }
  if (!result.run.sessionId) {
    return Response.json({ events: [] });
  }

  const parsed = listEventsQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const events = await listAgentRunEvents({
    sessionId: result.run.sessionId,
    chatId: result.run.chatId,
    workflowRunId: result.run.workflowRunId,
    requestId: result.run.requestId,
    after: parsed.data.after,
    limit: parsed.data.limit,
  });

  return Response.json({ events });
}
