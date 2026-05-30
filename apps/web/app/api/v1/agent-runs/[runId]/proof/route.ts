import {
  type AgentRunRouteContext,
  requireAgentApiRun,
} from "@/app/api/v1/agent-runs/[runId]/route";
import { buildAgentRunProof } from "@/lib/agent-api-runs/proof";

export async function GET(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:read"]);
  if (!result.ok) {
    return result.response;
  }

  return Response.json({ proof: await buildAgentRunProof(result.run) });
}
