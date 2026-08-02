import {
  getOwnedBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
} from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  toPublicBackgroundAgentRun,
  toSafeBackgroundAgentEvidence,
} from "@/lib/background-agents/public-run";

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
      { error: "Background run not found", errorKind: "not_found" },
      { status: 404 },
    );
  }
  const { run, agent } = row;

  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  return Response.json({
    run: toPublicBackgroundAgentRun(run),
    agent: toSafeBackgroundAgentEvidence(run, agent),
    events,
    outputs,
  });
}
