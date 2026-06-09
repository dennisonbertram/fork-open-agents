/**
 * Regression tests for GET + POST /api/settings/runtime-profiles.
 *
 * These tests would fail if the implementation in route.ts were reverted.
 *
 * Scenarios covered:
 * - REG-008: GET always returns built-in profiles even when user_default list is empty
 * - REG-009: POST without verificationCommands returns 400 (not 500 or 200)
 * - REG-010: GET returns user_default profiles before built-in profiles in the array
 * - REG-011: POST with invalid JSON body returns 400 (not 500)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const userDefaultProfiles: unknown[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  listUserDefaultProfiles: async () => userDefaultProfiles,
  createManagedRuntimeSavedProfile: async () => {
    throw new Error("Should not be called in these regression tests");
  },
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  listManagedRuntimeProfiles: () => [
    {
      id: "default",
      version: "built-in-v1",
      displayName: "Default",
      description: "The built-in default profile",
      setupCommands: [{ id: "s1", label: "L", description: "D", command: "c" }],
      verificationCommands: [
        { id: "v1", label: "L", description: "D", command: "c" },
      ],
      expectedTools: ["bun"],
      optionalTools: [],
      defaultPorts: [],
    },
  ],
}));

const routeModulePromise = import("./route");

beforeEach(() => {
  authenticatedUser = { ok: true, userId: "user-1" };
  userDefaultProfiles.length = 0;
});

describe("GET /api/settings/runtime-profiles regression", () => {
  // REG-008: built-in profiles always present
  test("REG-008: GET always includes at least one built-in profile", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/settings/runtime-profiles"),
    );
    const body = (await response.json()) as {
      profiles: Array<{ id: string; source: string }>;
    };

    expect(response.status).toBe(200);
    const builtIns = body.profiles.filter((p) => p.source === "built_in");
    expect(builtIns.length).toBeGreaterThan(0);
  });

  // REG-010: user_default profiles appear before built-in profiles
  test("REG-010: user_default profiles appear before built-in profiles in the list", async () => {
    userDefaultProfiles.push({
      id: "user-p1",
      userId: "user-1",
      sessionId: null,
      scope: "user_default",
      version: "created-now",
      displayName: "My Profile",
      description: "desc",
      setupCommands: [],
      verificationCommands: [],
      expectedTools: [],
      optionalTools: [],
      defaultPorts: [],
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/settings/runtime-profiles"),
    );
    const body = (await response.json()) as {
      profiles: Array<{ id: string; source: string }>;
    };

    expect(response.status).toBe(200);
    const firstProfile = body.profiles[0];
    expect(firstProfile?.source).toBe("user_default");
    expect(firstProfile?.id).toBe("user-p1");
  });
});

describe("POST /api/settings/runtime-profiles regression", () => {
  // REG-009: missing verificationCommands → 400
  test("REG-009: POST without verificationCommands returns 400", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Test",
          description: "Test",
          setupCommands: [
            {
              id: "s1",
              label: "L",
              description: "D",
              command: "bun install",
            },
          ],
          // verificationCommands intentionally omitted
          expectedTools: [],
          optionalTools: [],
          defaultPorts: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  // REG-011: malformed JSON body → 400
  test("REG-011: POST with malformed JSON body returns 400", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ this is not json",
      }),
    );

    expect(response.status).toBe(400);
  });
});
