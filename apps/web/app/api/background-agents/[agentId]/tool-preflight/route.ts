import { computeAgentToolPreflight } from "@/lib/background-agents/tool-preflight";
import { getOwnedBackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type RouteContext = {
  params: Promise<{ agentId: string }>;
};

/**
 * GET /api/background-agents/:agentId/tool-preflight (#802, epic #796 T6)
 *
 * Read-only dry-run: predicts per-toolkit availability for the agent's NEXT
 * run, using the same shared repo-policy/connection-status resolvers the
 * real bg-run path uses (see lib/background-agents/tool-preflight.ts). No
 * Composio session is created and no token is minted — GET with no side
 * effects, query params/body carry nothing that mutates state.
 */
export async function GET(_req: Request, context: RouteContext) {
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
      { error: "Background agent not found" },
      { status: 404 },
    );
  }

  const slugs = agent.composioToolkitSlugs ?? [];
  if (slugs.length === 0) {
    return Response.json({ toolkits: [] });
  }

  try {
    const result = await computeAgentToolPreflight({
      userId: authResult.userId,
      repoOwner: agent.repoOwner,
      repoName: agent.repoName,
      slugs,
      agentId: agent.id,
    });
    return Response.json(result);
  } catch (error) {
    // Distinct from a business-level "composio_unreachable" prediction for a
    // specific toolkit — this is the whole request failing (e.g. the repo
    // policy DB read itself errored).
    const message =
      error instanceof Error
        ? error.message
        : "Failed to compute tool preflight.";
    console.warn(
      JSON.stringify({
        event: "agent_tool_preflight.request_failed",
        level: "warn",
        agentId: agent.id,
        repoOwner: agent.repoOwner,
        repoName: agent.repoName,
        message,
      }),
    );
    return Response.json(
      { error: "Failed to compute tool preflight." },
      { status: 500 },
    );
  }
}
