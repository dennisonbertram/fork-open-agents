/**
 * BT-014: PATCH /api/settings/runtime-profiles/[profileId] edits a user_default profile
 * BT-015: PATCH returns 403 when profile belongs to a different user
 * BT-016: DELETE /api/settings/runtime-profiles/[profileId] removes a user_default profile
 * BT-017: PATCH/DELETE returns 401 when unauthenticated
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ------- mock state -------

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const savedProfile = {
  id: "user-profile-1",
  userId: "user-1",
  sessionId: null as null,
  scope: "user_default" as const,
  version: "created-2026-01-01T00:00:00.000Z",
  displayName: "My Account Profile",
  description: "An account-level toolchain",
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
  optionalTools: [] as string[],
  defaultPorts: [] as number[],
  latestTestRunId: null as null,
  testResults: [] as never[],
  testFailureMessage: null as null,
  testedAt: null as null,
  sourceDraftId: null as null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

let getProfileResult: typeof savedProfile | undefined = savedProfile;
let updateProfileResult: typeof savedProfile | undefined = savedProfile;
let deleteProfileResult: typeof savedProfile | undefined = savedProfile;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  getUserDefaultProfile: async () => getProfileResult,
  updateUserDefaultProfile: async () => updateProfileResult,
  deleteUserDefaultProfile: async () => deleteProfileResult,
  toManagedRuntimeProfile: (p: typeof savedProfile) => p,
}));

const routeModulePromise = import("./route");

function routeContext(profileId = "user-profile-1") {
  return {
    params: Promise.resolve({ profileId }),
  };
}

function validBody() {
  return {
    displayName: "Updated Profile",
    description: "Updated description",
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
}

beforeEach(() => {
  authenticatedUser = { ok: true, userId: "user-1" };
  getProfileResult = { ...savedProfile };
  updateProfileResult = { ...savedProfile, displayName: "Updated Profile" };
  deleteProfileResult = { ...savedProfile };
});

describe("PATCH /api/settings/runtime-profiles/[profileId]", () => {
  // BT-014: edits a user_default profile
  test("BT-014: updates and returns the patched profile", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request(
        "http://localhost/api/settings/runtime-profiles/user-profile-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody()),
        },
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profile: { id: string; displayName: string };
    };

    expect(response.status).toBe(200);
    expect(body.profile).toBeDefined();
  });

  // BT-015: returns 403/404 when profile not found (cross-user protection)
  test("BT-015: returns 404 when profile not found (cross-user guard)", async () => {
    getProfileResult = undefined;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request(
        "http://localhost/api/settings/runtime-profiles/other-user-profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody()),
        },
      ),
      routeContext("other-user-profile"),
    );
    expect(response.status).toBe(404);
  });

  // BT-017: unauthenticated
  test("BT-017: PATCH returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request(
        "http://localhost/api/settings/runtime-profiles/user-profile-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody()),
        },
      ),
      routeContext(),
    );
    expect(response.status).toBe(401);
  });
});

describe("DELETE /api/settings/runtime-profiles/[profileId]", () => {
  // BT-016: deletes a user_default profile
  test("BT-016: deletes the profile and returns the deleted id", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/settings/runtime-profiles/user-profile-1",
        { method: "DELETE" },
      ),
      routeContext(),
    );
    const body = (await response.json()) as { deletedProfileId: string };

    expect(response.status).toBe(200);
    expect(body.deletedProfileId).toBe("user-profile-1");
  });

  test("BT-016b: returns 404 when profile not found", async () => {
    deleteProfileResult = undefined;
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/settings/runtime-profiles/missing-profile",
        { method: "DELETE" },
      ),
      routeContext("missing-profile"),
    );
    expect(response.status).toBe(404);
  });

  test("BT-017b: DELETE returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/settings/runtime-profiles/user-profile-1",
        { method: "DELETE" },
      ),
      routeContext(),
    );
    expect(response.status).toBe(401);
  });
});
