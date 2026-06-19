import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getAgentLoopRunWithLoop,
  listAgentLoopEvents,
  listStepRunsForRun,
  listWatchdogRunsForLoopRun,
} from "@/lib/agent-loops/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ runId: string }> };

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/agent-loop-runs/[runId]
 *
 * The single poll target for the M1-09 run page.
 * Returns: { run, loop (summary), steps[], events[], watchdogRuns[] }
 *
 * Ownership-scoped: returns 404 for non-owned or non-existent runs.
 * The route checks run.userId against the authenticated userId to enforce
 * ownership (getAgentLoopRunWithLoop is NOT ownership-scoped by design).
 */
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
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
  const row = await getAgentLoopRunWithLoop(runId);

  if (!row) {
    return Response.json({ error: "Loop run not found" }, { status: 404 });
  }

  // Ownership check: run.userId must match the authenticated user.
  // Returns 404 (not 403) — no existence leak.
  if (row.run.userId !== authResult.userId) {
    return Response.json({ error: "Loop run not found" }, { status: 404 });
  }

  // Fetch steps, events, and watchdog runs concurrently (after ownership check)
  const [steps, events, watchdogRuns] = await Promise.all([
    listStepRunsForRun(runId),
    listAgentLoopEvents(runId),
    listWatchdogRunsForLoopRun(runId),
  ]);

  const body: GetAgentLoopRunDetailResponse = {
    run: row.run,
    loop: {
      id: row.loop.id,
      name: row.loop.name,
      repoOwner: row.loop.repoOwner,
      repoName: row.loop.repoName,
      guardrails: row.loop.guardrails,
    },
    steps,
    events,
    watchdogRuns,
  };

  return Response.json(body);
}
