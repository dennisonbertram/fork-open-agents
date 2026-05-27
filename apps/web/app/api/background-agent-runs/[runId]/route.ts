import {
  getOwnedBackgroundAgentRun,
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
  const run = await getOwnedBackgroundAgentRun({
    userId: authResult.userId,
    runId,
  });
  if (!run) {
    return Response.json(
      { error: "Background run not found" },
      { status: 404 },
    );
  }

  const [events, outputs] = await Promise.all([
    listBackgroundAgentEvents(run.id),
    listBackgroundAgentOutputs(run.id),
  ]);

  return Response.json({ run, events, outputs });
}
