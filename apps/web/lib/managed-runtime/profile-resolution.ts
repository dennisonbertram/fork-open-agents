import "server-only";

import {
  getManagedRuntimeProfile,
  isManagedRuntimeProfileId,
  type ManagedRuntimeProfile,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { getManagedRuntimeSavedProfile } from "@/lib/db/managed-runtime-saved-profiles";

export async function resolveManagedRuntimeProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeProfile> {
  if (isManagedRuntimeProfileId(params.profileId)) {
    return getManagedRuntimeProfile(params.profileId);
  }

  const savedProfile = await getManagedRuntimeSavedProfile({
    userId: params.userId,
    sessionId: params.sessionId,
    profileId: params.profileId,
  });
  if (savedProfile) {
    return {
      id: savedProfile.id,
      version: savedProfile.version,
      displayName: savedProfile.displayName,
      description: savedProfile.description,
      setupCommands: savedProfile.setupCommands,
      verificationCommands: savedProfile.verificationCommands,
      expectedTools: savedProfile.expectedTools,
      optionalTools: savedProfile.optionalTools,
      defaultPorts: savedProfile.defaultPorts,
    };
  }

  return getManagedRuntimeProfile();
}
