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

const userDefaultProfile = {
  id: "user-profile-abc123",
  version: "created-2026-06-01T00:00:00.000Z",
  displayName: "My Account Profile",
  description: "Account-level toolchain",
  setupCommands: [
    {
      id: "install",
      label: "Install",
      description: "Install deps",
      command: "bun install",
    },
  ],
  verificationCommands: [
    {
      id: "verify",
      label: "Verify",
      description: "Verify bun",
      command: "bun --version",
    },
  ],
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [],
};

let savedProfileResult: typeof savedProfile | undefined = savedProfile;
let userDefaultProfileResult: typeof userDefaultProfile | undefined;
const calls: Array<Record<string, unknown>> = [];
const userDefaultCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  getManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push(params);
    return savedProfileResult;
  },
  getUserDefaultProfile: async (params: Record<string, unknown>) => {
    userDefaultCalls.push(params);
    return userDefaultProfileResult;
  },
}));

const modulePromise = import("./profile-resolution");

describe("resolveManagedRuntimeProfile", () => {
  beforeEach(() => {
    savedProfileResult = savedProfile;
    userDefaultProfileResult = undefined;
    calls.length = 0;
    userDefaultCalls.length = 0;
  });

  test("resolves built-in profile ids without querying saved profiles", async () => {
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "web-bun-agent-browser",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.source).toBe("built_in");
    expect(result.requestedProfileId).toBe("web-bun-agent-browser");
    expect(result.resolvedProfileId).toBe("web-bun-agent-browser");
    expect(result.profile.id).toBe("web-bun-agent-browser");
    expect(result.profile.displayName).toContain("Web");
    expect(calls).toEqual([]);
    expect(userDefaultCalls).toEqual([]);
  });

  test("resolves saved session profile ids to their custom command contract", async () => {
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.source).toBe("session");
    expect(result.requestedProfileId).toBe("session-profile-draft-1");
    expect(result.resolvedProfileId).toBe("session-profile-draft-1");
    expect(result.profile).toMatchObject({
      id: "session-profile-draft-1",
      displayName: "Repo Bun profile",
      expectedTools: ["bun"],
      defaultPorts: [3000],
    });
    expect(result.profile.setupCommands[0]).toMatchObject({
      id: "install-bun",
      command: "bun --version",
    });
    expect(result.profile.verificationCommands[0]).toMatchObject({
      id: "verify-bun",
      command: "bun --version",
    });
    expect(calls[0]).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });
  });

  // BT: user_default scope resolves (currently RED — resolution never queries
  // user_default scope and falls back to the built-in default at line 38).
  test("resolves a user_default-scope profile owned by the requesting user", async () => {
    savedProfileResult = undefined;
    userDefaultProfileResult = userDefaultProfile;
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "user-profile-abc123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.source).toBe("user_default");
    expect(result.requestedProfileId).toBe("user-profile-abc123");
    expect(result.resolvedProfileId).toBe("user-profile-abc123");
    expect(result.profile.displayName).toBe("My Account Profile");
    expect(userDefaultCalls[0]).toEqual({
      userId: "user-1",
      profileId: "user-profile-abc123",
    });
  });

  // BT: unresolvable id returns a typed failure — never a silent built-in
  // fallback (currently RED — line 38 silently returns getManagedRuntimeProfile()).
  test("returns a typed profile_not_found failure instead of silently falling back", async () => {
    savedProfileResult = undefined;
    userDefaultProfileResult = undefined;
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure result");
    }
    expect(result.kind).toBe("profile_not_found");
    expect(result.requestedProfileId).toBe("session-profile-missing");
    expect(typeof result.nextAction).toBe("string");
    expect(result.nextAction.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-missing",
    });
    expect(userDefaultCalls[0]).toEqual({
      userId: "user-1",
      profileId: "session-profile-missing",
    });
  });

  // BT: lookup order is built-in -> session-scope -> user_default-scope.
  test("checks session scope before user_default scope", async () => {
    savedProfileResult = savedProfile;
    userDefaultProfileResult = userDefaultProfile;
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok result");
    }
    expect(result.source).toBe("session");
    expect(userDefaultCalls).toEqual([]);
  });

  // REGRESSION: a profile id scoped to a DIFFERENT session (or deleted
  // entirely) must never resolve to the built-in default. This is the exact
  // defect this ticket fixes (profile-resolution.ts:38 before the fix); if a
  // future change reintroduces a catch-all fallback at the end of
  // resolveManagedRuntimeProfile, this test fails because it asserts the
  // union's failure branch instead of accepting any built-in profile shape.
  test("regression: a profile id scoped to a different session never silently resolves to the built-in default", async () => {
    // Neither the session-scope store nor the user_default store has this
    // id — simulating a profile that belongs to someone else's session (the
    // store's own WHERE clause already filters by sessionId/userId, so a
    // cross-session id naturally misses both lookups).
    savedProfileResult = undefined;
    userDefaultProfileResult = undefined;
    const { resolveManagedRuntimeProfile } = await modulePromise;

    const result = await resolveManagedRuntimeProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-belonging-to-someone-else",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(
        "regression failure: resolution silently fell back to a profile instead of failing closed",
      );
    }
    expect(result.kind).toBe("profile_not_found");
    // Must NOT be any built-in profile id — the historic bug returned
    // getManagedRuntimeProfile() (the default built-in) with no id/source
    // signal that anything went wrong.
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("id", "web-bun-agent-browser");
  });
});
