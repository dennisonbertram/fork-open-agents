import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { cancelLoopRun } from "@/lib/agent-loops/run-controls";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { mapControlError } from "../_lib/map-control-error";

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(
  _req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isAgentLoopsEnabled()) {
    return Response.json(
      {
        errorKind: "feature_disabled",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  const { runId } = await ctx.params;

  try {
    await cancelLoopRun(runId, authResult.userId);
    return Response.json({ success: true });
  } catch (err) {
    return mapControlError(err);
  }
}
