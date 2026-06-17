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
  // Pass agentId directly to the DB query so the index on (agentId, createdAt)
  // is used — avoids fetching up to 50 rows to filter in JS.
  const runs = await listBackgroundAgentRuns({
    userId: authResult.userId,
    agentId,
    limit: 1,
  });

  const latest = runs[0] ?? null;

  return Response.json({
    latestRunId: latest?.id ?? null,
    latestRunStatus: latest?.status ?? null,
    latestOutputUrl: latest?.outputUrl ?? null,
  });
}
