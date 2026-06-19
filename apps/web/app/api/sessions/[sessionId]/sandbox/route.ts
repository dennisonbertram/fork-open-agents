import "server-only";

import { getSessionById, updateSession } from "@/lib/db/sessions";
import { emitSessionEvent } from "@/lib/observability/events";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * POST /api/sessions/[sessionId]/sandbox
 *
 * On-demand sandbox provisioning for sandbox-free (no-repo) sessions.
 *
 * - If the session already has a sandboxState, this is a safe no-op that
 *   returns the current session state without emitting an event.
 * - If the session has no sandbox, sets sandboxState: { type: "vercel" } and
 *   lifecycleState: "provisioning", then emits a session.sandbox.attached event.
 *
 * The actual sandbox VM creation is handled client-side after this endpoint
 * transitions the DB state to "provisioning".
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;

  const existingSession = await getSessionById(sessionId);
  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotent: if sandbox is already present, no-op and return current state.
  if (existingSession.sandboxState !== null) {
    return Response.json({ session: existingSession });
  }

  // Transition the session to the provisioning lifecycle so the client
  // knows it should create the sandbox VM.
  const updatedSession = await updateSession(sessionId, {
    sandboxState: { type: "vercel" },
    lifecycleState: "provisioning",
    lifecycleVersion: (existingSession.lifecycleVersion ?? 0) + 1,
  });

  if (!updatedSession) {
    return Response.json(
      { error: "Failed to update session" },
      { status: 500 },
    );
  }

  // Emit observability event so the activity feed reflects the user action.
  await emitSessionEvent({
    sessionId,
    userId: session.user.id,
    source: "sandbox",
    actorType: "user",
    actorId: session.user.id,
    eventName: "session.sandbox.attached",
    status: "info",
    summary: "User attached an on-demand sandbox to this session.",
  });

  return Response.json({ session: updatedSession });
}
