import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { deleteMcpServer, updateMcpServer } from "@/lib/mcp/store";
import { McpServerConflictError, updateMcpServerSchema } from "@/lib/mcp/types";

interface RouteContext {
  params: Promise<{ serverId: string }>;
}

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { serverId } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateMcpServerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid MCP server",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const server = await updateMcpServer(
      authResult.userId,
      serverId,
      parsed.data,
    );
    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }
    return Response.json({ server });
  } catch (error) {
    if (error instanceof McpServerConflictError) {
      return Response.json(
        { error: "A server with that name already exists." },
        { status: 409 },
      );
    }

    return Response.json(
      { error: "Failed to save MCP server." },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { serverId } = await context.params;

  const deleted = await deleteMcpServer(authResult.userId, serverId);
  if (!deleted) {
    return Response.json({ error: "Server not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
