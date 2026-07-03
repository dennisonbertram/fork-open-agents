import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  listManagedRuntimeSavedProfiles,
  toManagedRuntimeProfile,
} from "@/lib/db/managed-runtime-saved-profiles";
import {
  getManagedRuntimeProfileDraft,
  toManagedRuntimeProfileDraftSnapshot,
} from "@/lib/db/managed-runtime-profile-drafts";

export type ManagedRuntimeProfileOption = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupCommandCount: number;
  verificationCommandCount: number;
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
  source: "built_in" | "session";
  testStatus?: "untested" | "passed" | "failed";
  testedAt?: string | null;
  /**
   * The scope actually executed for the current test evidence (Decision D6):
   * "verify" (verification commands only) vs "setup_and_verify". A missing
   * value means there is no persisted test evidence for this profile yet.
   * The evidence badge only grants the green "Tested" label from a
   * setup_and_verify pass; a verify-only pass renders "Verified on current
   * sandbox — setup not tested" instead.
   */
  lastTestScope?: "verify" | "setup_and_verify" | null;
};

export type ManagedRuntimeProfilesResponse = {
  profiles: ManagedRuntimeProfileOption[];
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const { sessionId } = await params;
  const ownedSession = await requireOwnedSession({
    userId: auth.userId,
    sessionId,
  });
  if (!ownedSession.ok) {
    return ownedSession.response;
  }

  const savedProfiles = await listManagedRuntimeSavedProfiles({
    userId: auth.userId,
    sessionId,
  });

  const builtInOptions = listManagedRuntimeProfiles().map((profile) =>
    toProfileOption(profile, "built_in" as const),
  );
  const savedOptions = await Promise.all(
    savedProfiles.map(async (profile) => {
      const isEditedProfile = !profile.version.startsWith("draft-");
      const savedEvidence = getSavedProfileTestEvidence(profile);
      const sourceDraft =
        profile.sourceDraftId && !isEditedProfile && !savedEvidence
          ? await getManagedRuntimeProfileDraft({
              userId: auth.userId,
              sessionId,
              draftId: profile.sourceDraftId,
            })
          : undefined;
      const sourceDraftSnapshot = sourceDraft
        ? toManagedRuntimeProfileDraftSnapshot(sourceDraft)
        : undefined;

      return toProfileOption(toManagedRuntimeProfile(profile), "session", {
        testStatus: savedEvidence
          ? savedEvidence.testStatus
          : isEditedProfile
            ? "untested"
            : sourceDraftSnapshot
              ? getDraftTestStatus(sourceDraftSnapshot)
              : "untested",
        testedAt: savedEvidence
          ? savedEvidence.testedAt
          : isEditedProfile
            ? null
            : (sourceDraftSnapshot?.testedAt ?? null),
        lastTestScope: savedEvidence
          ? savedEvidence.lastTestScope
          : isEditedProfile
            ? null
            : (sourceDraftSnapshot?.lastTestScope ?? null),
      });
    }),
  );

  return Response.json({
    profiles: [...savedOptions, ...builtInOptions],
  } satisfies ManagedRuntimeProfilesResponse);
}

function toProfileOption(
  profile: ReturnType<typeof listManagedRuntimeProfiles>[number],
  source: ManagedRuntimeProfileOption["source"],
  evidence?: Pick<
    ManagedRuntimeProfileOption,
    "testStatus" | "testedAt" | "lastTestScope"
  >,
): ManagedRuntimeProfileOption {
  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    setupCommandCount: profile.setupCommands.length,
    verificationCommandCount: profile.verificationCommands.length,
    expectedTools: profile.expectedTools,
    optionalTools: profile.optionalTools,
    defaultPorts: profile.defaultPorts,
    source,
    ...evidence,
  };
}

function getDraftTestStatus(
  draft: ReturnType<typeof toManagedRuntimeProfileDraftSnapshot>,
): NonNullable<ManagedRuntimeProfileOption["testStatus"]> {
  if (
    draft.status === "needs_changes" ||
    draft.testFailureMessage ||
    draft.testResults.some(
      (result) => result.status === "failed" && result.required !== false,
    )
  ) {
    return "failed";
  }
  if (draft.testedAt) {
    return "passed";
  }
  return "untested";
}

function getSavedProfileTestEvidence(profile: {
  testFailureMessage?: string | null;
  testResults?: Array<{ status: string; required?: boolean }>;
  testedAt?: Date | null;
  lastTestScope?: "verify" | "setup_and_verify" | null;
}): Pick<
  ManagedRuntimeProfileOption,
  "testStatus" | "testedAt" | "lastTestScope"
> | null {
  const testResults = profile.testResults ?? [];
  if (
    !profile.testedAt &&
    !profile.testFailureMessage &&
    testResults.length === 0
  ) {
    return null;
  }

  const hasRequiredFailure = testResults.some(
    (result) => result.status === "failed" && result.required !== false,
  );

  return {
    testStatus:
      profile.testFailureMessage || hasRequiredFailure ? "failed" : "passed",
    testedAt: profile.testedAt?.toISOString() ?? null,
    lastTestScope: profile.lastTestScope ?? null,
  };
}
