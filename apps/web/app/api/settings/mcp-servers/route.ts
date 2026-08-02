import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createMcpServer, listMcpServers } from "@/lib/mcp/store";
import { McpServerConflictError, createMcpServerSchema } from "@/lib/mcp/types";

export async function GET(_req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const servers = await listMcpServers(authResult.userId);
  return Response.json({ servers });
}

export async function POST(req: Request) {
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

  const parsed = createMcpServerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid MCP server",
        details: parsed.error.flatten(),
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  try {
    const server = await createMcpServer(authResult.userId, parsed.data);
    return Response.json({ server }, { status: 201 });
  } catch (error) {
    if (error instanceof McpServerConflictError) {
      return Response.json(
        {
          error: "A server with that name already exists.",
          errorKind: "conflict",
        },
        { status: 409 },
      );
    }

    return Response.json(
      { error: "Failed to save MCP server.", errorKind: "invalid_request" },
      { status: 400 },
    );
  }
}
