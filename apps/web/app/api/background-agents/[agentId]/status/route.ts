import { listBackgroundAgentRuns } from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type RouteContext = {
  params: Promise<{ agentId: string }>;
};

/**
 * GET /api/background-agents/:agentId/status
 *
 * Returns the latest run's status fields for the authenticated user's agent.
 * Used for lightweight per-card polling when a run is active.
 * Only returns non-sensitive status fields — no payload or event data.
 */
export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { agentId } = await context.params;

  // Fetch the latest run for this agent scoped to the authenticated user.
  // We only need the most recent record (limit: 1), filtered by agentId client-side
  // to avoid a new DB query shape — listBackgroundAgentRuns is userId-scoped.
  const runs = await listBackgroundAgentRuns({
    userId: authResult.userId,
    limit: 50,
  });

  const agentRuns = runs
    .filter((r) => r.agentId === agentId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const latest = agentRuns[0] ?? null;

  return Response.json({
    latestRunId: latest?.id ?? null,
    latestRunStatus: latest?.status ?? null,
    latestOutputUrl: latest?.outputUrl ?? null,
  });
}
