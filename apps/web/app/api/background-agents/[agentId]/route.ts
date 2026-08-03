import {
  deleteBackgroundAgent,
  updateBackgroundAgent,
} from "@/lib/background-agents/store";
import { updateBackgroundAgentSchema } from "@/lib/background-agents/types";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type RouteContext = {
  params: Promise<{ agentId: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
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

  const parsed = updateBackgroundAgentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid background agent update",
        details: parsed.error.flatten(),
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const { agentId } = await context.params;
  const agent = await updateBackgroundAgent(
    authResult.userId,
    agentId,
    parsed.data,
  );
  if (!agent) {
    return Response.json(
      { error: "Background agent not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ agent });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { agentId } = await context.params;
  const deleted = await deleteBackgroundAgent(authResult.userId, agentId);
  if (!deleted) {
    return Response.json(
      { error: "Background agent not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ success: true });
}
