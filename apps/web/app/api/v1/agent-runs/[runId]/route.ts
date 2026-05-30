import {
  verifyBearerApiToken,
  type AgentApiScope,
} from "@/lib/api-auth/tokens";
import {
  getAgentApiRunForToken,
  selfHealAgentApiRunStatus,
} from "@/lib/agent-api-runs/runs";
import { getAgentRunSnapshot } from "@/lib/agent-api-runs/snapshots";

export type AgentRunRouteContext = {
  params: Promise<{ runId: string }>;
};

export async function requireAgentApiRun(
  req: Request,
  context: AgentRunRouteContext,
  scopes: AgentApiScope[],
) {
  const auth = await verifyBearerApiToken({
    authorization: req.headers.get("authorization"),
    requiredScopes: scopes,
    userAgent: req.headers.get("user-agent"),
  });
  if (!auth.ok) {
    return {
      ok: false as const,
      response: Response.json(
        { error: auth.message, code: auth.code },
        { status: auth.status },
      ),
    };
  }

  const { runId } = await context.params;
  const run = await getAgentApiRunForToken({
    runId,
    userId: auth.userId,
    tokenId: auth.token.id,
  });
  if (!run) {
    return {
      ok: false as const,
      response: Response.json({ error: "Run not found" }, { status: 404 }),
    };
  }

  return {
    ok: true as const,
    auth,
    run: await selfHealAgentApiRunStatus(run),
  };
}

export async function GET(req: Request, context: AgentRunRouteContext) {
  const result = await requireAgentApiRun(req, context, ["agent_runs:read"]);
  if (!result.ok) {
    return result.response;
  }

  return Response.json({ agentRun: await getAgentRunSnapshot(result.run) });
}
