import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

let authenticatedUser:
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    } = { ok: true, userId: "user-1" };
let ownedSession:
  | {
      ok: true;
      sessionRecord: { id: string; userId: string };
    }
  | {
      ok: false;
      response: Response;
    } = {
  ok: true,
  sessionRecord: { id: "session-1", userId: "user-1" },
};

const savedProfile = {
  id: "session-profile-draft-1",
  sourceDraftId: "draft-1",
  version: "draft-2026-05-24T00:00:00.000Z",
  displayName: "Repo Bun profile",
  description: "Generated profile for this repository",
  setupCommands: [
    {
      id: "install-bun",
      label: "Install Bun",
      description: "Install Bun",
      command: "bun --version",
    },
  ],
  verificationCommands: [
    {
      id: "verify-bun",
      label: "Verify Bun",
      description: "Verify Bun",
      command: "bun --version",
    },
  ],
  expectedTools: ["bun"],
  optionalTools: [],
  defaultPorts: [3000],
  testResults: [] as ManagedRuntimeCommandObservation[],
  testFailureMessage: null as string | null,
  testedAt: null as Date | null,
};

const calls: Array<Record<string, unknown>> = [];
let profileResult: typeof savedProfile | undefined = savedProfile;
let profileVersion = "draft-2026-05-24T00:00:00.000Z";
let sourceDraftResult:
  | {
      id: string;
      status: string;
      testFailureMessage: string | null;
      testResults: Array<Record<string, unknown>>;
      testedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  | undefined = {
  id: "draft-1",
  status: "tested",
  testFailureMessage: null,
  testResults: [
    {
      commandId: "verify-bun",
      label: "Verify Bun",
      status: "passed",
      required: true,
      exitCode: 0,
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
    },
  ],
  testedAt: new Date("2026-05-24T00:01:00.000Z"),
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:01:00.000Z"),
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
  requireOwnedSession: async () => ownedSession,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  deleteManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push({ fn: "delete", ...params });
    return profileResult;
  },
  finishManagedRuntimeSavedProfileTest: async () => profileResult,
  getManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push({ fn: "get", ...params });
    return profileResult
      ? { ...profileResult, version: profileVersion }
      : undefined;
  },
  markManagedRuntimeSavedProfileTesting: async () => profileResult,
  toManagedRuntimeProfile: (profile: typeof savedProfile) => profile,
  updateManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push({ fn: "update", ...params });
    return profileResult
      ? { ...profileResult, version: profileVersion }
      : undefined;
  },
}));

mock.module("@/lib/db/managed-runtime-profile-drafts", () => ({
  getManagedRuntimeProfileDraft: async (params: Record<string, unknown>) => {
    calls.push({ fn: "getDraft", ...params });
    return sourceDraftResult;
  },
  toManagedRuntimeProfileDraftSnapshot: (
    draft: NonNullable<typeof sourceDraftResult>,
  ) => ({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    testedAt: draft.testedAt?.toISOString() ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  }),
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    }),
  };
}

function request(method: "GET" | "PATCH" | "DELETE", body?: unknown) {
  return new Request(
    "http://localhost/api/sessions/session-1/managed-runtime/profiles/session-profile-draft-1",
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

describe("/api/sessions/[sessionId]/managed-runtime/profiles/[profileId]", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    ownedSession = {
      ok: true,
      sessionRecord: { id: "session-1", userId: "user-1" },
    };
    profileResult = savedProfile;
    profileVersion = "draft-2026-05-24T00:00:00.000Z";
    savedProfile.testResults = [];
    savedProfile.testFailureMessage = null;
    savedProfile.testedAt = null;
    sourceDraftResult = {
      id: "draft-1",
      status: "tested",
      testFailureMessage: null,
      testResults: [
        {
          commandId: "verify-bun",
          label: "Verify Bun",
          status: "passed",
          required: true,
          exitCode: 0,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:01.000Z",
        },
      ],
      testedAt: new Date("2026-05-24T00:01:00.000Z"),
      createdAt: new Date("2026-05-24T00:00:00.000Z"),
      updatedAt: new Date("2026-05-24T00:01:00.000Z"),
    };
    calls.length = 0;
  });

  test("GET returns saved session profile details with source draft evidence", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as {
      profile: { id: string; setupCommands: unknown[] };
      sourceDraft: {
        id: string;
        status: string;
        testedAt: string | null;
        testResults: Array<{ commandId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.profile.id).toBe("session-profile-draft-1");
    expect(body.profile.setupCommands).toHaveLength(1);
    expect(body.sourceDraft).toMatchObject({
      id: "draft-1",
      status: "tested",
      testedAt: "2026-05-24T00:01:00.000Z",
    });
    expect(body.sourceDraft.testResults[0]?.commandId).toBe("verify-bun");
    expect(calls[0]).toMatchObject({
      fn: "get",
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    });
    expect(calls[1]).toMatchObject({
      fn: "getDraft",
      draftId: "draft-1",
    });
  });

  test("GET omits source draft evidence for edited saved profiles", async () => {
    profileVersion = "edited-2026-05-24T00:02:00.000Z";
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as {
      profile: { id: string; version: string };
      sourceDraft?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.profile.version).toBe("edited-2026-05-24T00:02:00.000Z");
    expect(body.sourceDraft).toBeUndefined();
    expect(calls.some((call) => call.fn === "getDraft")).toBe(false);
  });

  test("GET returns current saved profile test evidence after re-test", async () => {
    profileVersion = "edited-2026-05-24T00:02:00.000Z";
    savedProfile.testResults = [
      {
        commandId: "verify-bun",
        label: "Verify Bun",
        status: "passed",
        required: true,
        startedAt: "2026-05-24T00:03:00.000Z",
      },
    ];
    savedProfile.testedAt = new Date("2026-05-24T00:04:00.000Z");
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as {
      testEvidence?: {
        status: string;
        testedAt: string | null;
        testResults: Array<{ commandId: string }>;
      };
      sourceDraft?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence).toMatchObject({
      status: "passed",
      testedAt: "2026-05-24T00:04:00.000Z",
    });
    expect(body.testEvidence?.testResults[0]?.commandId).toBe("verify-bun");
    expect(body.sourceDraft).toBeUndefined();
  });

  test("PATCH updates editable profile fields", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        displayName: "Edited profile",
        description: "Updated commands",
        setupCommands: savedProfile.setupCommands,
        verificationCommands: savedProfile.verificationCommands,
        expectedTools: ["bun"],
        optionalTools: ["node"],
        defaultPorts: [3000, 5173],
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({
      fn: "update",
      profileId: "session-profile-draft-1",
      profile: {
        displayName: "Edited profile",
        optionalTools: ["node"],
        defaultPorts: [3000, 5173],
      },
    });
  });

  test("PATCH rejects invalid profile payloads", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        displayName: "",
        description: "Missing commands",
        setupCommands: [],
        verificationCommands: [],
      }),
      routeContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid managed runtime profile");
    expect(calls).toEqual([]);
  });

  test("DELETE removes the saved profile and returns fallback profile id", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(request("DELETE"), routeContext());
    const body = (await response.json()) as {
      deletedProfileId: string;
      fallbackProfileId: string;
    };

    expect(response.status).toBe(200);
    expect(body.deletedProfileId).toBe("session-profile-draft-1");
    expect(body.fallbackProfileId).toBe("web-bun-agent-browser");
    expect(calls[0]).toMatchObject({
      fn: "delete",
      fallbackProfileId: "web-bun-agent-browser",
    });
  });

  test("returns 404 when the profile is missing", async () => {
    profileResult = undefined;
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });
});
