/**
 * BT-008: GET /api/settings/runtime-profiles returns user_default profiles + built-ins
 * BT-009: GET /api/settings/runtime-profiles returns 401 when unauthenticated
 * BT-010: POST /api/settings/runtime-profiles creates a user_default profile
 * BT-011: POST /api/settings/runtime-profiles returns 400 on invalid body
 * BT-012: POST /api/settings/runtime-profiles returns 401 when unauthenticated
 * BT-013: POST creates a profile with scope=user_default and sessionId=null
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

// ------- mock state -------

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const userDefaultProfiles: Array<{
  id: string;
  userId: string;
  sessionId: null;
  scope: "user_default";
  version: string;
  displayName: string;
  description: string;
  setupCommands: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
  }>;
  verificationCommands: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
  }>;
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
  latestTestRunId: null;
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage: null;
  testedAt: null;
  createdAt: Date;
  updatedAt: Date;
}> = [];

let createdProfile: (typeof userDefaultProfiles)[number] | undefined =
  undefined;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  listUserDefaultProfiles: async () => userDefaultProfiles,
  createManagedRuntimeSavedProfile: async () => createdProfile,
  toManagedRuntimeProfile: (
    profile: (typeof userDefaultProfiles)[number],
  ) => profile,
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  listManagedRuntimeProfiles: () => [
    {
      id: "default",
      version: "built-in-v1",
      displayName: "Default",
      description: "The built-in default profile",
      setupCommands: [],
      verificationCommands: [],
      expectedTools: [],
      optionalTools: [],
      defaultPorts: [],
    },
  ],
}));

const routeModulePromise = import("./route");

// -------- helpers --------

function validBody() {
  return {
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
    optionalTools: [],
    defaultPorts: [],
  };
}

beforeEach(() => {
  authenticatedUser = { ok: true, userId: "user-1" };
  userDefaultProfiles.length = 0;
  createdProfile = {
    id: "user-profile-1",
    userId: "user-1",
    sessionId: null,
    scope: "user_default",
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
    optionalTools: [],
    defaultPorts: [],
    latestTestRunId: null,
    testResults: [],
    testFailureMessage: null,
    testedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
});

// -------- tests --------

describe("GET /api/settings/runtime-profiles", () => {
  // BT-008: returns user_default profiles + built-ins
  test("BT-008: returns empty user profiles list alongside built-in profiles", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/settings/runtime-profiles"),
    );
    const body = (await response.json()) as {
      profiles: Array<{ id: string; source: string }>;
    };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.profiles)).toBe(true);
    const builtIn = body.profiles.find((p) => p.source === "built_in");
    expect(builtIn).toBeDefined();
  });

  test("BT-008b: includes user_default profiles in the response", async () => {
    userDefaultProfiles.push({
      id: "user-profile-1",
      userId: "user-1",
      sessionId: null,
      scope: "user_default",
      version: "created-2026-01-01T00:00:00.000Z",
      displayName: "My Profile",
      description: "Test",
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
    const userProfile = body.profiles.find((p) => p.id === "user-profile-1");
    expect(userProfile).toBeDefined();
    expect(userProfile?.source).toBe("user_default");
  });

  // BT-009: unauthenticated
  test("BT-009: returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/settings/runtime-profiles"),
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/settings/runtime-profiles", () => {
  // BT-010: creates a user_default profile
  test("BT-010: creates a profile and returns the created profile", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      }),
    );
    const body = (await response.json()) as {
      profile: { id: string; displayName: string; source: string };
    };

    expect(response.status).toBe(201);
    expect(body.profile).toBeDefined();
    expect(body.profile.displayName).toBe("My Account Profile");
    expect(body.profile.source).toBe("user_default");
  });

  // BT-011: invalid body returns 400
  test("BT-011: returns 400 when body is missing required fields", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  // BT-012: unauthenticated
  test("BT-012: returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      }),
    );
    expect(response.status).toBe(401);
  });

  // BT-013: profile has scope=user_default and sessionId=null
  test("BT-013: created profile has source=user_default in response", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody()),
      }),
    );
    const body = (await response.json()) as {
      profile: { source: string };
    };

    expect(response.status).toBe(201);
    expect(body.profile.source).toBe("user_default");
  });
});
