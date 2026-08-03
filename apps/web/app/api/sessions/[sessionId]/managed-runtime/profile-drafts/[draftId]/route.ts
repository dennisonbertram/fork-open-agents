import { setupManagedRuntimeProfileOutputSchema } from "@open-agents/agent";
import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  getManagedRuntimeProfileDraft,
  toManagedRuntimeProfileDraftSnapshot,
  updateManagedRuntimeProfileDraftDecision,
} from "@/lib/db/managed-runtime-profile-drafts";
import { applyDraftAsSessionManagedRuntimeProfile } from "@/lib/db/managed-runtime-saved-profiles";

const updateDraftRequestSchema = z.object({
  output: setupManagedRuntimeProfileOutputSchema,
  // Decision D6: "Approve anyway" over a failed/absent test persists this
  // flag (MR-1's force_approved column) so the UI can show "Approved
  // without passing test" instead of silently treating the override as a
  // normal approval.
  forceApproved: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; draftId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId, draftId } = await params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  const draft = await getManagedRuntimeProfileDraft({
    userId: auth.userId,
    sessionId,
    draftId,
  });
  if (!draft) {
    return Response.json(
      { error: "Profile draft not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  return Response.json({ draft: toManagedRuntimeProfileDraftSnapshot(draft) });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; draftId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId, draftId } = await params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
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

  const parsedBody = updateDraftRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "Invalid managed runtime profile draft update",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const draft = await updateManagedRuntimeProfileDraftDecision({
    userId: auth.userId,
    sessionId,
    draftId,
    output: parsedBody.data.output,
    forceApproved: parsedBody.data.forceApproved,
  });
  if (!draft) {
    return Response.json(
      { error: "Profile draft not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (parsedBody.data.output.decision !== "approved") {
    return Response.json({
      draft: toManagedRuntimeProfileDraftSnapshot(draft),
    });
  }

  const savedProfile = await applyDraftAsSessionManagedRuntimeProfile({
    userId: auth.userId,
    sessionId,
    draft,
  });
  const appliedDraft = await getManagedRuntimeProfileDraft({
    userId: auth.userId,
    sessionId,
    draftId,
  });

  return Response.json({
    draft: toManagedRuntimeProfileDraftSnapshot(appliedDraft ?? draft),
    savedProfileId: savedProfile.id,
    appliedToSessionId: sessionId,
  });
}
