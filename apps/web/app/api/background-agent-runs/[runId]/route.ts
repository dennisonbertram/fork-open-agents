import {
  getOwnedBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
} from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { runId } = await context.params;
  const row = await getOwnedBackgroundAgentRunWithAgent({
    userId: authResult.userId,
    runId,
  });
  if (!row) {
    return Response.json(
      { error: "Background run not found" },
      { status: 404 },
    );
  }
  const { run, agent } = row;

  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  return Response.json({
    run,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          permissions: agent.permissions,
          checkCommand: agent.checkCommand,
        }
      : null,
    events,
    outputs,
  });
}
