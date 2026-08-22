import { after } from "next/server";
import { isManagedRuntimeProfileId } from "@open-agents/sandbox/managed-runtime-profiles";
import {
  invalidUpdateSessionKeys,
  type UpdateSessionRequest,
  updateSessionRequestSchema,
} from "@/app/api/sessions/[sessionId]/_lib/update-session-request";
import {
  deleteSession,
  getSessionById,
  updateSession,
} from "@/lib/db/sessions";
import { getInferenceProfileByIdForUser } from "@/lib/db/inference-profiles";
import { getManagedRuntimeSavedProfile } from "@/lib/db/managed-runtime-saved-profiles";
import { archiveSession } from "@/lib/sandbox/archive-session";
import { hasRuntimeSandboxState } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json(
      { error: "Session not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json(
      { error: "Forbidden", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  return Response.json({ session: existingSession });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json(
      { error: "Session not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json(
      { error: "Forbidden", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = updateSessionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const invalidKeys = invalidUpdateSessionKeys(parsed.error);
    console.warn(
      JSON.stringify({
        service: "sessions-api",
        event: "session-update-rejected",
        userId: session.user.id,
        sessionId,
        errorKind: "invalid_session_update",
        invalidKeys,
      }),
    );
    return Response.json(
      {
        error: "Invalid session update payload",
        errorKind: "invalid_session_update",
      },
      { status: 400 },
    );
  }

  const body: UpdateSessionRequest = parsed.data;

  if (body.managedRuntimeProfileId !== undefined) {
    const savedProfile = isManagedRuntimeProfileId(body.managedRuntimeProfileId)
      ? undefined
      : await getManagedRuntimeSavedProfile({
          userId: session.user.id,
          sessionId,
          profileId: body.managedRuntimeProfileId,
        });
    if (
      !isManagedRuntimeProfileId(body.managedRuntimeProfileId) &&
      !savedProfile
    ) {
      return Response.json(
        {
          error: "Invalid managed runtime profile",
          errorKind: "invalid_request",
        },
        { status: 400 },
      );
    }
  }

  if (
    body.inferenceProfileId !== undefined &&
    body.inferenceProfileId !== null
  ) {
    const profile = await getInferenceProfileByIdForUser(
      session.user.id,
      body.inferenceProfileId,
    );
    if (!profile || !profile.enabled) {
      return Response.json(
        { error: "Invalid inference profile", errorKind: "invalid_request" },
        { status: 400 },
      );
    }
  }

  const shouldStopSandboxAfterArchive =
    body.status === "archived" && existingSession.status !== "archived";

  const shouldUnarchive =
    body.status === "running" && existingSession.status === "archived";

  if (
    shouldUnarchive &&
    !existingSession.snapshotUrl &&
    hasRuntimeSandboxState(existingSession.sandboxState)
  ) {
    return Response.json(
      {
        error:
          "Sandbox is still being paused for this archived session. Please try unarchiving again in a few seconds.",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  const updatePayload: UpdateSessionRequest &
    Partial<{
      lifecycleState: "archived" | null;
      lifecycleError: null;
      sandboxExpiresAt: null;
      hibernateAfter: null;
    }> = { ...body };

  if (shouldUnarchive) {
    // Reset lifecycle state so the session can be resumed normally.
    // If there is saved sandbox state, the client will surface Resume again.
    updatePayload.lifecycleState = null;
    updatePayload.lifecycleError = null;
  }

  const updatedSession = shouldStopSandboxAfterArchive
    ? (
        await archiveSession(sessionId, {
          currentSession: existingSession,
          update: updatePayload,
          logPrefix: "[Sessions]",
          scheduleBackgroundWork: after,
        })
      ).session
    : await updateSession(sessionId, updatePayload);

  if (!updatedSession) {
    return Response.json(
      { error: "Session not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  console.info(
    JSON.stringify({
      service: "sessions-api",
      event: "session-updated",
      userId: session.user.id,
      sessionId,
      updatedFields: Object.keys(parsed.data),
    }),
  );

  return Response.json({ session: updatedSession });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json(
      { error: "Session not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json(
      { error: "Forbidden", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  await deleteSession(sessionId);
  return Response.json({ success: true });
}
