import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { createAgentLoop, listAgentLoops } from "@/lib/agent-loops/store";
import { isAgentLoopsEnabled } from "@/lib/agent-loops/config";
import { createAgentLoopBodySchema } from "@/lib/agent-loops/request-schemas";

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
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

  const parsed = createAgentLoopBodySchema.safeParse(body);
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

  const result = await createAgentLoop(authResult.userId, {
    name: parsed.data.name,
    description: parsed.data.description,
    repoOwner: parsed.data.repoOwner,
    repoName: parsed.data.repoName,
    definition: parsed.data.definition,
    guardrails: parsed.data.guardrails,
    permissions: parsed.data.permissions,
    status: parsed.data.status,
  });

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

  return Response.json({ loop: result.loop }, { status: 201 });
}

export async function GET(req: Request): Promise<Response> {
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

  const url = new URL(req.url);
  const repoOwner = url.searchParams.get("repoOwner")?.trim() || undefined;
  const repoName = url.searchParams.get("repoName")?.trim() || undefined;

  const filter = repoOwner && repoName ? { repoOwner, repoName } : undefined;

  const loops = await listAgentLoops(authResult.userId, filter);
  return Response.json({ loops });
}
