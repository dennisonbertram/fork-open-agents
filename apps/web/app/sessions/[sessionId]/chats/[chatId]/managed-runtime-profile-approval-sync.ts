type RuntimeMode = "classic" | "managed_runtime";

export type ManagedRuntimeProfileApprovalSyncDependencies = {
  currentRuntimeMode: RuntimeMode;
  mutateManagedProfiles: () => Promise<unknown>;
  updateManagedRuntimeProfile: (profileId: string) => Promise<void>;
  updateRuntimeMode: (runtimeMode: RuntimeMode) => Promise<void>;
};

export async function syncApprovedManagedRuntimeProfile(
  savedProfileId: string,
  {
    currentRuntimeMode,
    mutateManagedProfiles,
    updateManagedRuntimeProfile,
    updateRuntimeMode,
  }: ManagedRuntimeProfileApprovalSyncDependencies,
) {
  await mutateManagedProfiles();

  if (currentRuntimeMode !== "managed_runtime") {
    await updateRuntimeMode("managed_runtime");
  }

  await updateManagedRuntimeProfile(savedProfileId);
  await mutateManagedProfiles();
}
