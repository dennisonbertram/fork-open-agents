import "server-only";

import {
  listToolEntriesForAgent,
  approveToolEntry,
  rejectToolEntry,
} from "@/lib/db/agent-tool-entries";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { z } from "zod";

// ── GET /api/agents/tool-entries?agentId=<id> ─────────────────────────────────
/**
 * List all tool entries for the authenticated user's agent.
 * Requires ?agentId= query param.
 * Owner-scoped: only entries for the requesting user are returned.
 */
export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId");

  if (!agentId) {
    return Response.json(
      {
        error: "Missing required query param: agentId",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const entries = await listToolEntriesForAgent(authResult.userId, agentId);

  return Response.json({ entries });
}

// ── POST /api/agents/tool-entries ─────────────────────────────────────────────
const postBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  entryId: z.string().min(1),
});

/**
 * Approve or reject a proposed tool entry.
 * Owner-scoped: returns 404 when the entry doesn't belong to the requesting user.
 */
export async function POST(req: Request): Promise<Response> {
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

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request body",
        details: parsed.error.flatten(),
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const { action, entryId } = parsed.data;

  let ok: boolean;
  if (action === "approve") {
    ok = await approveToolEntry(authResult.userId, entryId);
  } else {
    ok = await rejectToolEntry(authResult.userId, entryId);
  }

  if (!ok) {
    return Response.json(
      {
        error: "Tool entry not found or not owned by you",
        errorKind: "not_found",
      },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, action });
}
