import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let createdProfileInput: unknown;
let updatedDefaultsInput: unknown;
let updatedProfileInput: { profileId: string; profile: unknown } | null = null;
let deletedProfileId: string | null = null;

const profile = {
  id: "profile-1",
  userId: "user-1",
  name: "GitHub",
  toolkitSlugs: ["github"],
  authConfigIdsByToolkit: {},
  connectedAccountIdsByToolkit: {},
  workbenchEnabled: false,
  allowInChatConnectionManagement: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
}));

mock.module("@/lib/db/composio", () => ({
  listComposioToolProfiles: async (_userId: string) => [profile],
  getComposioAgentDefaults: async (_userId: string) =>
    defaultComposioAgentDefaults,
  createComposioToolProfile: async (_userId: string, input: unknown) => {
    createdProfileInput = input;
    return profile;
  },
  updateComposioAgentDefaults: async (_userId: string, defaults: unknown) => {
    updatedDefaultsInput = defaults;
    return {
      ...defaultComposioAgentDefaults,
      main: {
        defaultProfileId: "profile-1",
        allowChatOverride: true,
      },
    };
  },
  updateComposioToolProfile: async (
    _userId: string,
    profileId: string,
    profilePatch: unknown,
  ) => {
    updatedProfileInput = { profileId, profile: profilePatch };
    return { ...profile, name: "GitHub Tools" };
  },
  deleteComposioToolProfile: async (_userId: string, profileId: string) => {
    deletedProfileId = profileId;
    return true;
  },
}));

const routeModulePromise = import("./route");

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/settings/composio", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/settings/composio", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createdProfileInput = undefined;
    updatedDefaultsInput = undefined;
    updatedProfileInput = null;
    deletedProfileId = null;
    delete process.env.COMPOSIO_API_KEY;
  });

  test("GET returns profiles, defaults, and disabled status", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      status: { configured: boolean };
      profiles: unknown[];
      defaults: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.status.configured).toBe(false);
    expect(body.profiles).toHaveLength(1);
    expect(body.defaults).toEqual(defaultComposioAgentDefaults);
  });

  test("POST rejects an empty profile and accepts a bounded profile", async () => {
    const { POST } = await routeModulePromise;

    const invalidResponse = await POST(
      request("POST", { name: "", toolkits: [] }),
    );
    expect(invalidResponse.status).toBe(400);

    const response = await POST(
      request("POST", {
        name: "GitHub",
        toolkitSlugs: ["github"],
        authConfigIdsByToolkit: {},
        connectedAccountIdsByToolkit: {},
        workbenchEnabled: false,
        allowInChatConnectionManagement: false,
      }),
    );

    expect(response.status).toBe(201);
    expect(createdProfileInput).toMatchObject({
      name: "GitHub",
      toolkitSlugs: ["github"],
    });
  });

  test("PATCH updates defaults and a profile atomically from one request", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        defaults: {
          main: {
            defaultProfileId: "profile-1",
            allowChatOverride: true,
          },
        },
        profileId: "profile-1",
        profile: {
          name: "GitHub Tools",
        },
      }),
    );
    const body = (await response.json()) as {
      defaults: unknown;
      profile: { name: string };
    };

    expect(response.status).toBe(200);
    expect(updatedDefaultsInput).toMatchObject({
      main: {
        defaultProfileId: "profile-1",
        allowChatOverride: true,
      },
    });
    expect(updatedProfileInput).toEqual({
      profileId: "profile-1",
      profile: {
        name: "GitHub Tools",
      },
    });
    expect(body.profile.name).toBe("GitHub Tools");
  });

  test("DELETE removes a user profile", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      request("DELETE", {
        profileId: "profile-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(deletedProfileId).toBe("profile-1");
  });
});
