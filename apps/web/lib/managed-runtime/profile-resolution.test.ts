import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const savedProfile = {
  id: "session-profile-draft-1",
  version: "draft-2026-05-24T00:00:00.000Z",
  displayName: "Repo Bun profile",
  description: "Generated profile for this repository",
  setupCommands: [
    {
      id: "install-bun",
      label: "Install Bun",
      description: "Install Bun for this repository",
      command: "bun --version",
    },
  ],
  verificationCommands: [
    {
      id: "verify-bun",
      label: "Verify Bun",
      description: "Verify Bun is available",
      command: "bun --version",
    },
  ],
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [3000],
};

let savedProfileResult: typeof savedProfile | undefined = savedProfile;
const calls: Array<Record<string, unknown>> = [];

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  getManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push(params);
    return savedProfileResult;
  },
}));

const modulePromise = import("./profile-resolution");

describe("resolveManagedRuntimeProfile", () => {
  beforeEach(() => {
    savedProfileResult = savedProfile;
    calls.length = 0;
  });

  test("resolves built-in profile ids without querying saved profiles", async () => {
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const profile = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "web-bun-agent-browser",
    });

    expect(profile.id).toBe("web-bun-agent-browser");
    expect(profile.displayName).toContain("Web");
    expect(calls).toEqual([]);
  });

  test("resolves saved session profile ids to their custom command contract", async () => {
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const profile = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });

    expect(profile).toMatchObject({
      id: "session-profile-draft-1",
      displayName: "Repo Bun profile",
      expectedTools: ["bun"],
      defaultPorts: [3000],
    });
    expect(profile.setupCommands[0]).toMatchObject({
      id: "install-bun",
      command: "bun --version",
    });
    expect(profile.verificationCommands[0]).toMatchObject({
      id: "verify-bun",
      command: "bun --version",
    });
    expect(calls[0]).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });
  });

  test("falls back to the default built-in profile when a custom id is missing", async () => {
    savedProfileResult = undefined;
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const profile = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-missing",
    });

    expect(profile.id).toBe("web-bun-agent-browser");
    expect(calls[0]).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-missing",
    });
  });
});
