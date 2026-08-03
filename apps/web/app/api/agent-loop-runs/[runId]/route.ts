import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getAgentLoopRunWithLoop,
  listAgentLoopComposioEvents,
  listAgentLoopEvents,
  listStepRunsForRun,
  listWatchdogRunsForLoopRun,
} from "@/lib/agent-loops/store";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { mergeEventsForSummary } from "./_lib/merge-events-for-summary";
import {
  toPublicAgentLoopRun,
  toSafeAgentLoopEvidence,
} from "@/lib/agent-loops/public-run";

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

  const { runId } = await ctx.params;
  const row = await getAgentLoopRunWithLoop(runId);

  if (!row) {
    return Response.json(
      { error: "Loop run not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  // Ownership check: run.userId must match the authenticated user.
  // Returns 404 (not 403) — no existence leak.
  if (row.run.userId !== authResult.userId) {
    return Response.json(
      { error: "Loop run not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  // Fetch steps, events, and watchdog runs concurrently (after ownership check)
  const [steps, cappedEvents, composioEvents, watchdogRuns] = await Promise.all(
    [
      listStepRunsForRun(runId),
      listAgentLoopEvents(runId),
      // #798 (Codex review P2-2): listAgentLoopEvents is a bounded
      // newest-200 slice. agent-loop.step.composio.* events are emitted
      // early in a step, so a chatty run's newer events can push them off
      // that slice entirely — merge in an uncapped, composio-scoped fetch
      // so deriveLoopComposioWarnings(events) never silently loses them.
      listAgentLoopComposioEvents(runId),
      listWatchdogRunsForLoopRun(runId),
    ],
  );

  const events = mergeEventsForSummary(cappedEvents, composioEvents);
  const safeLoop = toSafeAgentLoopEvidence(row.run, row.loop);

  const body: GetAgentLoopRunDetailResponse = {
    run: toPublicAgentLoopRun(row.run),
    loop: safeLoop
      ? {
          id: safeLoop.id,
          name: safeLoop.name,
          repoOwner: safeLoop.repoOwner,
          repoName: safeLoop.repoName,
          guardrails: safeLoop.guardrails,
          sourceDeleted: safeLoop.sourceDeleted,
          sourceActive: safeLoop.sourceActive,
        }
      : null,
    steps,
    events,
    watchdogRuns,
  };

  return Response.json(body);
}
