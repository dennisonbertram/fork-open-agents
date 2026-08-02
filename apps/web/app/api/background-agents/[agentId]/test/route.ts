import { dispatchManualBackgroundAgentTest } from "@/lib/background-agents/dispatcher";
import { getOwnedBackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type RouteContext = {
  params: Promise<{ agentId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { agentId } = await context.params;
  const agent = await getOwnedBackgroundAgentWithTriggers({
    userId: authResult.userId,
    agentId,
  });
  if (!agent) {
    return Response.json(
      { error: "Background agent not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (agent.triggers.length === 0) {
    return Response.json(
      {
        error: "Background agent has no triggers to test",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const result = await dispatchManualBackgroundAgentTest({
    agent,
    requestId: req.headers.get("x-request-id"),
  });

  if (!result.enabled) {
    return Response.json(
      {
        ...result,
        error: "Background agents are disabled",
        errorKind: "forbidden",
      },
      { status: 403 },
    );
  }

  return Response.json(result);
}
