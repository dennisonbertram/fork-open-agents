import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  deleteAgentLoop,
  getOwnedAgentLoop,
  AgentLoopArchivedError,
  updateAgentLoop,
} from "@/lib/agent-loops/store";
import { listTriggersForLoop } from "@/lib/background-agents/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { updateAgentLoopBodySchema } from "@/lib/agent-loops/request-schemas";

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteContext = { params: Promise<{ loopId: string }> };

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!isAgentLoopsEnabled()) {
    return Response.json(
      {
        errorKind: "feature_disabled",
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  const { loopId } = await ctx.params;
  const loop = await getOwnedAgentLoop({ userId: authResult.userId, loopId });
  if (!loop) {
    return Response.json(
      { error: "Agent loop not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  const triggers = await listTriggersForLoop(loopId);
  return Response.json({ loop, triggers });
}

export async function PATCH(
  req: Request,
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
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = updateAgentLoopBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        errorKind: "invalid_request",
        error: `Invalid request body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        message: `Invalid request body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      },
      { status: 400 },
    );
  }

  const { loopId } = await ctx.params;
  // AgentLoopArchivedError is a typed conflict, not a crash. Letting it
  // propagate gives Next.js a generic 500, which tells the caller nothing and
  // hides the one thing they need to know: un-archive the loop first.
  let result: Awaited<ReturnType<typeof updateAgentLoop>>;
  try {
    result = await updateAgentLoop(authResult.userId, loopId, parsed.data);
  } catch (error) {
    if (error instanceof AgentLoopArchivedError) {
      const message = error.message;
      return Response.json(
        {
          errorKind: "conflict",
          error: message,
          message,
        },
        { status: 409 },
      );
    }
    throw error;
  }

  if (!result.ok) {
    return Response.json(
      {
        errorKind: "loop_invalid",
        error: "Loop definition is invalid.",
        message: "Loop definition is invalid.",
        errors: result.errors,
      },
      { status: 400 },
    );
  }

  if (!result.loop) {
    return Response.json(
      { error: "Agent loop not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ loop: result.loop });
}

export async function DELETE(
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
        error:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
        message:
          "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.",
      },
      { status: 403 },
    );
  }

  const { loopId } = await ctx.params;
  const deleted = await deleteAgentLoop(authResult.userId, loopId);
  if (!deleted) {
    return Response.json(
      { error: "Agent loop not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ success: true });
}
