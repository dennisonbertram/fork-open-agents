import {
  createBackgroundAgent,
  listBackgroundAgents,
} from "@/lib/background-agents/store";
import { createBackgroundAgentSchema } from "@/lib/background-agents/types";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const agents = await listBackgroundAgents(authResult.userId);
  return Response.json({ agents });
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

  const parsed = createBackgroundAgentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid background agent" },
      { status: 400 },
    );
  }

  const agent = await createBackgroundAgent(authResult.userId, parsed.data);
  return Response.json({ agent }, { status: 201 });
}
