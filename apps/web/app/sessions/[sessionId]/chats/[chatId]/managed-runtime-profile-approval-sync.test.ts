import { describe, expect, test } from "bun:test";
import { syncApprovedManagedRuntimeProfile } from "./managed-runtime-profile-approval-sync";

describe("syncApprovedManagedRuntimeProfile", () => {
  test("refreshes saved profiles, switches to managed runtime, selects the approved profile, and refreshes again", async () => {
    const calls: string[] = [];

    await syncApprovedManagedRuntimeProfile("session-profile-draft-1", {
      currentRuntimeMode: "classic",
      mutateManagedProfiles: async () => {
        calls.push("mutateManagedProfiles");
      },
      updateManagedRuntimeProfile: async (profileId) => {
        calls.push(`updateManagedRuntimeProfile:${profileId}`);
      },
      updateRuntimeMode: async (runtimeMode) => {
        calls.push(`updateRuntimeMode:${runtimeMode}`);
      },
    });

    expect(calls).toEqual([
      "mutateManagedProfiles",
      "updateRuntimeMode:managed_runtime",
      "updateManagedRuntimeProfile:session-profile-draft-1",
      "mutateManagedProfiles",
    ]);
  });

  test("does not write runtime mode again when the session is already managed runtime", async () => {
    const calls: string[] = [];

    await syncApprovedManagedRuntimeProfile("session-profile-draft-2", {
      currentRuntimeMode: "managed_runtime",
      mutateManagedProfiles: async () => {
        calls.push("mutateManagedProfiles");
      },
      updateManagedRuntimeProfile: async (profileId) => {
        calls.push(`updateManagedRuntimeProfile:${profileId}`);
      },
      updateRuntimeMode: async (runtimeMode) => {
        calls.push(`updateRuntimeMode:${runtimeMode}`);
      },
    });

    expect(calls).toEqual([
      "mutateManagedProfiles",
      "updateManagedRuntimeProfile:session-profile-draft-2",
      "mutateManagedProfiles",
    ]);
  });
});
