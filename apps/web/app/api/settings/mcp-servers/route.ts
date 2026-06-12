import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createMcpServer, listMcpServers } from "@/lib/mcp/store";
import { createMcpServerSchema } from "@/lib/mcp/types";

export async function GET() {
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMcpServerSchema.safeParse(body);
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
    const server = await createMcpServer(authResult.userId, parsed.data);
    return Response.json({ server }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Duplicate name — friendly message, no SQL text
    if (/unique|duplicate/i.test(message)) {
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
