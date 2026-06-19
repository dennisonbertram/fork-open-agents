/**
 * GET/POST /api/agent-loops/sweep
 *
 * Cron-secret authenticated sweep endpoint that marks stalled agent loop runs.
 * A run is considered stalled when it is in queued/running status and its
 * latest event is older than AGENT_LOOPS_STALL_MINUTES (default 15).
 *
 * Authentication mirrors the background-agents cron pattern:
 *   Authorization: Bearer <CRON_SECRET>
 *   x-background-agents-cron-secret: <CRON_SECRET>
 *
 * Returns: { stalledCount, checkedCount }
 */

import { getBackgroundAgentsCronSecret } from "@/lib/background-agents/config";
import { sweepStalledLoopRuns } from "@/lib/agent-loops/sweep";

function isAuthorized(req: Request, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (authorization === `Bearer ${secret}`) {
    return true;
  }
  return req.headers.get("x-background-agents-cron-secret") === secret;
}

async function handleSweep(req: Request) {
  const secret = getBackgroundAgentsCronSecret();
  if (!secret) {
    return Response.json(
      {
        error: "CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured",
      },
      { status: 500 },
    );
  }

  if (!isAuthorized(req, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepStalledLoopRuns();

  return Response.json(result);
}

export async function GET(req: Request) {
  return handleSweep(req);
}

export async function POST(req: Request) {
  return handleSweep(req);
}
