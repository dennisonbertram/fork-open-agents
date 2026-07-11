import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { listAgentLoopRuns } from "@/lib/agent-loops/store";
import { dispatchManualAgentLoopStart } from "@/lib/agent-loops/dispatcher-bridge";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ loopId: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
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

  const { loopId } = await ctx.params;
  const requestId = crypto.randomUUID();

  const result = await dispatchManualAgentLoopStart({
    userId: authResult.userId,
    loopId,
    requestId,
  });

  if (result.dispatchFailed) {
    // Issue #763 — no false success: the run row is already marked failed
    // with errorKind=dispatch_failed; the route must not return
    // {created:true} in this case.
    return Response.json(
      {
        success: false,
        errorKind: "dispatch_failed",
        message: result.errorMessage,
        runId: result.runId,
      },
      { status: 502 },
    );
  }

  if (result.skipped) {
    switch (result.reason) {
      case "feature_disabled":
        return Response.json(
          {
            errorKind: "feature_disabled",
            message:
              "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
          },
          { status: 403 },
        );

      case "repo_not_allowed":
        return Response.json(
          {
            errorKind: "repo_not_allowed",
            message:
              "This repository is not in the AGENT_LOOPS_ALLOWED_REPOS allowlist.",
          },
          { status: 403 },
        );

      case "repo_allowlist_unconfigured":
        return Response.json(
          {
            errorKind: "repo_allowlist_unconfigured",
            message:
              "Agent loop repository access is not configured. Set AGENT_LOOPS_ALLOWED_REPOS before starting unattended runs.",
          },
          { status: 503 },
        );

      case "repo_allowlist_invalid":
        return Response.json(
          {
            errorKind: "repo_allowlist_invalid",
            message:
              "Agent loop repository access is misconfigured. Correct AGENT_LOOPS_ALLOWED_REPOS before starting unattended runs.",
          },
          { status: 503 },
        );

      case "ownership_fail":
        return Response.json(
          { error: "Agent loop not found" },
          { status: 404 },
        );

      case "active_run":
        return Response.json(
          {
            errorKind: "active_run",
            message:
              "This loop already has an active or paused run. Wait for it to complete, resume, or cancel it before starting a new run.",
            ...(result.activeRunId !== undefined
              ? { activeRunId: result.activeRunId }
              : {}),
          },
          { status: 409 },
        );

      case "loop_inactive":
        return Response.json(
          {
            errorKind: "loop_inactive",
            message:
              "Loop must be in 'active' status to start a run. Update the loop status to 'active' first.",
          },
          { status: 409 },
        );

      case "loop_invalid":
        return Response.json(
          {
            errorKind: "loop_invalid",
            message: "Loop definition is invalid and cannot be executed.",
          },
          { status: 400 },
        );

      default: {
        // TypeScript exhaustive check — if this compiles, all reasons are handled.
        const _exhaustive: never = result;
        return Response.json(
          { error: `Unexpected skip reason: ${String(_exhaustive)}` },
          { status: 500 },
        );
      }
    }
  }

  return Response.json(
    {
      runId: result.runId,
      created: result.created,
    },
    { status: 202 },
  );
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
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

  const { loopId } = await ctx.params;

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const runs = await listAgentLoopRuns({
    loopId,
    userId: authResult.userId,
    limit,
  });

  return Response.json({ runs });
}
