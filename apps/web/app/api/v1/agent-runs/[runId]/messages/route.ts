import {
  type AgentRunRouteContext,
  requireAgentApiRun,
} from "@/app/api/v1/agent-runs/[runId]/route";
import { listMessagesQuerySchema } from "@/lib/agent-api-runs/schemas";
import { listAgentRunMessages } from "@/lib/agent-api-runs/snapshots";

export async function GET(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:read"]);
  if (!result.ok) {
    return result.response;
  }
  if (!result.run.chatId) {
    return Response.json({ messages: [] });
  }

  const parsed = listMessagesQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const includeUiParts = parsed.data.include === "ui_parts";
  const messages = await listAgentRunMessages({
    chatId: result.run.chatId,
    includeUiParts,
  });

  return Response.json({ messages });
}
