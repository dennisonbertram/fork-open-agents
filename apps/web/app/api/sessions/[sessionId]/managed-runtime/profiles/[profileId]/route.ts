import { DEFAULT_MANAGED_RUNTIME_PROFILE_ID } from "@open-agents/sandbox/managed-runtime-profiles";
import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  deleteManagedRuntimeSavedProfile,
  getManagedRuntimeSavedProfile,
  toManagedRuntimeProfile,
  updateManagedRuntimeSavedProfile,
} from "@/lib/db/managed-runtime-saved-profiles";
import {
  getManagedRuntimeProfileDraft,
  toManagedRuntimeProfileDraftSnapshot,
} from "@/lib/db/managed-runtime-profile-drafts";

const commandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  required: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  setupCommands: z.array(commandSchema).min(1),
  verificationCommands: z.array(commandSchema).min(1),
  expectedTools: z.array(z.string().trim().min(1)).default([]),
  optionalTools: z.array(z.string().trim().min(1)).default([]),
  defaultPorts: z.array(z.number().int().positive()).default([]),
});

export type ManagedRuntimeProfileDetailResponse = {
  profile: ReturnType<typeof toManagedRuntimeProfile>;
  testEvidence?: {
    status: "passed" | "failed";
    testFailureMessage: string | null;
    testResults: NonNullable<
      Awaited<ReturnType<typeof getManagedRuntimeSavedProfile>>
    >["testResults"];
    testedAt: string | null;
  };
  sourceDraft?: Pick<
    ReturnType<typeof toManagedRuntimeProfileDraftSnapshot>,
    "id" | "status" | "testFailureMessage" | "testResults" | "testedAt"
  >;
};

type RouteContext = {
  params: Promise<{ sessionId: string; profileId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId, profileId } = await context.params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  const profile = await getManagedRuntimeSavedProfile({
    userId: auth.userId,
    sessionId,
    profileId,
  });
  if (!profile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json(
    await buildProfileDetailResponse({
      userId: auth.userId,
      sessionId,
      profile,
    }),
  );
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId, profileId } = await context.params;
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateProfileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid managed runtime profile" },
      { status: 400 },
    );
  }

  const profile = await updateManagedRuntimeSavedProfile({
    userId: auth.userId,
    sessionId,
    profileId,
    profile: parsed.data,
  });
  if (!profile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json(
    await buildProfileDetailResponse({
      userId: auth.userId,
      sessionId,
      profile,
    }),
  );
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId, profileId } = await context.params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  const profile = await deleteManagedRuntimeSavedProfile({
    userId: auth.userId,
    sessionId,
    profileId,
    fallbackProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
  });
  if (!profile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json({
    deletedProfileId: profile.id,
    fallbackProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
    sessionsReset: profile.sessionsReset,
  });
}

async function buildProfileDetailResponse(params: {
  userId: string;
  sessionId: string;
  profile: NonNullable<
    Awaited<ReturnType<typeof getManagedRuntimeSavedProfile>>
  >;
}): Promise<ManagedRuntimeProfileDetailResponse> {
  const testEvidence = getSavedProfileTestEvidence(params.profile);
  const sourceDraft =
    params.profile.sourceDraftId &&
    params.profile.version.startsWith("draft-") &&
    !testEvidence
      ? await getManagedRuntimeProfileDraft({
          userId: params.userId,
          sessionId: params.sessionId,
          draftId: params.profile.sourceDraftId,
        })
      : undefined;
  const sourceDraftSnapshot = sourceDraft
    ? toManagedRuntimeProfileDraftSnapshot(sourceDraft)
    : undefined;

  return {
    profile: toManagedRuntimeProfile(params.profile),
    testEvidence,
    sourceDraft: sourceDraftSnapshot
      ? {
          id: sourceDraftSnapshot.id,
          status: sourceDraftSnapshot.status,
          testFailureMessage: sourceDraftSnapshot.testFailureMessage,
          testResults: sourceDraftSnapshot.testResults,
          testedAt: sourceDraftSnapshot.testedAt,
        }
      : undefined,
  };
}

function getSavedProfileTestEvidence(
  profile: NonNullable<
    Awaited<ReturnType<typeof getManagedRuntimeSavedProfile>>
  >,
): ManagedRuntimeProfileDetailResponse["testEvidence"] {
  const testResults = profile.testResults ?? [];
  if (
    !profile.testedAt &&
    !profile.testFailureMessage &&
    testResults.length === 0
  ) {
    return undefined;
  }

  const hasRequiredFailure = testResults.some(
    (result) => result.status === "failed" && result.required !== false,
  );

  return {
    status:
      profile.testFailureMessage || hasRequiredFailure ? "failed" : "passed",
    testFailureMessage: profile.testFailureMessage,
    testResults,
    testedAt: profile.testedAt?.toISOString() ?? null,
  };
}
