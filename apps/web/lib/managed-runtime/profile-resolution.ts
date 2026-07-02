import "server-only";

import {
  getManagedRuntimeProfile,
  isManagedRuntimeProfileId,
  type ManagedRuntimeProfile,
} from "@open-agents/sandbox/managed-runtime-profiles";
import {
  getManagedRuntimeSavedProfile,
  getUserDefaultProfile,
} from "@/lib/db/managed-runtime-saved-profiles";
import { nextActionFor } from "./profile-run-status";

export type ManagedRuntimeProfileResolutionSource =
  | "built_in"
  | "session"
  | "user_default";

export type ManagedRuntimeProfileResolutionOk = {
  ok: true;
  profile: ManagedRuntimeProfile;
  source: ManagedRuntimeProfileResolutionSource;
  requestedProfileId: string;
  resolvedProfileId: string;
};

export type ManagedRuntimeProfileResolutionFailure = {
  ok: false;
  kind: "profile_not_found" | "profile_scope_mismatch";
  requestedProfileId: string;
  nextAction: string;
};

export type ManagedRuntimeProfileResolution =
  | ManagedRuntimeProfileResolutionOk
  | ManagedRuntimeProfileResolutionFailure;

/**
 * Resolves a requested managed-runtime profile id to its full profile
 * contract. Lookup order: built-in -> session-scope -> user_default-scope
 * (owner-checked). Never silently substitutes the built-in default — an
 * unresolvable id returns a typed `profile_not_found` failure instead
 * (see #808 section 3).
 */
export async function resolveManagedRuntimeProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeProfileResolution> {
  if (isManagedRuntimeProfileId(params.profileId)) {
    const profile = getManagedRuntimeProfile(params.profileId);
    return {
      ok: true,
      profile,
      source: "built_in",
      requestedProfileId: params.profileId,
      resolvedProfileId: profile.id,
    };
  }

  const savedProfile = await getManagedRuntimeSavedProfile({
    userId: params.userId,
    sessionId: params.sessionId,
    profileId: params.profileId,
  });
  if (savedProfile) {
    return {
      ok: true,
      source: "session",
      requestedProfileId: params.profileId,
      resolvedProfileId: savedProfile.id,
      profile: {
        id: savedProfile.id,
        version: savedProfile.version,
        displayName: savedProfile.displayName,
        description: savedProfile.description,
        setupCommands: savedProfile.setupCommands,
        verificationCommands: savedProfile.verificationCommands,
        expectedTools: savedProfile.expectedTools,
        optionalTools: savedProfile.optionalTools,
        defaultPorts: savedProfile.defaultPorts,
      },
    };
  }

  const userDefaultProfile = await getUserDefaultProfile({
    userId: params.userId,
    profileId: params.profileId,
  });
  if (userDefaultProfile) {
    return {
      ok: true,
      source: "user_default",
      requestedProfileId: params.profileId,
      resolvedProfileId: userDefaultProfile.id,
      profile: {
        id: userDefaultProfile.id,
        version: userDefaultProfile.version,
        displayName: userDefaultProfile.displayName,
        description: userDefaultProfile.description,
        setupCommands: userDefaultProfile.setupCommands,
        verificationCommands: userDefaultProfile.verificationCommands,
        expectedTools: userDefaultProfile.expectedTools,
        optionalTools: userDefaultProfile.optionalTools,
        defaultPorts: userDefaultProfile.defaultPorts,
      },
    };
  }

  return {
    ok: false,
    kind: "profile_not_found",
    requestedProfileId: params.profileId,
    nextAction: nextActionFor("profile_not_found"),
  };
}
