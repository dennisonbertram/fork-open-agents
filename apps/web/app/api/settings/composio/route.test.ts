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
const connectedAccountsList = mock(async (_params: unknown) => ({}));
let clientError: Error | null = null;
let createComposioToolProfileError: Error | null = null;
let updateComposioToolProfileError: Error | null = null;

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
  requireOwnedSession: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
  requireOwnedSessionChat: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
}));

mock.module("@/lib/db/composio", () => ({
  listComposioToolProfiles: async (_userId: string) => [profile],
  listComposioProfileOptionsForRepository: async () => ({
    profiles: [profile],
    profileOptions: [{ ...profile, available: true, disabledReason: null }],
    repositorySettings: null,
  }),
  getRepositoryComposioSettings: async () => null,
  upsertRepositoryComposioSettings: async () => ({}),
  isComposioProfileAllowedForRepository: async () => ({
    allowed: true,
    reason: null,
  }),
  getComposioAgentDefaults: async (_userId: string) =>
    defaultComposioAgentDefaults,
  createComposioToolProfile: async (_userId: string, input: unknown) => {
    if (createComposioToolProfileError) {
      throw createComposioToolProfileError;
    }
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
    if (updateComposioToolProfileError) {
      throw updateComposioToolProfileError;
    }
    updatedProfileInput = { profileId, profile: profilePatch };
    return { ...profile, name: "GitHub Tools" };
  },
  deleteComposioToolProfile: async (_userId: string, profileId: string) => {
    deletedProfileId = profileId;
    return true;
  },
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => {
    if (clientError) {
      throw clientError;
    }
    return {
      connectedAccounts: {
        list: connectedAccountsList,
      },
    };
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

function getRequest(params?: Record<string, string>): Request {
  const url = new URL("http://localhost/api/settings/composio");
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

describe("/api/settings/composio", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createdProfileInput = undefined;
    updatedDefaultsInput = undefined;
    updatedProfileInput = null;
    deletedProfileId = null;
    clientError = null;
    createComposioToolProfileError = null;
    updateComposioToolProfileError = null;
    connectedAccountsList.mockClear();
    delete process.env.COMPOSIO_API_KEY;
  });

  test("GET returns profiles, defaults, and disabled status", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(getRequest());
    const body = (await response.json()) as {
      status: { configured: boolean };
      profiles: unknown[];
      profileOptions: unknown[];
      defaults: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.status.configured).toBe(false);
    expect(body.profiles).toHaveLength(1);
    expect(body.profileOptions).toHaveLength(1);
    expect(body.defaults).toEqual(defaultComposioAgentDefaults);
  });

  test("GET live-checks configured Composio and reports invalid keys", async () => {
    process.env.COMPOSIO_API_KEY = "ak_invalid";
    clientError = new Error(
      '401 {"error":{"message":"Invalid API key: ak_invalid","code":10401}}',
    );
    const { GET } = await routeModulePromise;

    const response = await GET(getRequest());
    const body = (await response.json()) as {
      status: { configured: boolean; available: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toMatchObject({
      configured: true,
      available: false,
    });
    expect(body.status.message).toContain("COMPOSIO_API_KEY is invalid");
    expect(body.status.message).not.toContain("ak_invalid");
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

  // BUG 1: POST with duplicate name must return 409 even when drizzle wraps the
  // real PG error in `cause` (DrizzleQueryError shape: message = "Failed query:
  // <sql>\nparams: <params>", cause = PostgresError with code "23505").
  test("POST with duplicate profile name (DrizzleQueryError via cause.code 23505) returns 409", async () => {
    const { POST } = await routeModulePromise;

    // Realistic shape: DrizzleQueryError wraps the postgres driver error in cause.
    const pgError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "composio_tool_profiles_user_id_name_unique"',
      ),
      { code: "23505" },
    );
    const drizzleError = Object.assign(
      new Error(
        'Failed query: insert into "composio_tool_profiles" (id, user_id, name, toolkit_slugs) values ($1, $2, $3, $4)\nparams: some-uuid,user-1,GitHub,[github]',
      ),
      { cause: pgError },
    );
    createComposioToolProfileError = drizzleError;

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

    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("A profile with that name already exists.");
    expect(JSON.stringify(body)).not.toContain("insert into");
    expect(JSON.stringify(body)).not.toContain("Failed query");
  });

  // Also verify that a profile whose name contains "unique" does NOT trigger 409
  // when the error is actually unrelated (e.g. a generic DB failure) — the old
  // regex would scan the SQL text and mismatch on the profile name itself.
  test("POST generic server error with profile named 'unique tools' returns 400, not 409", async () => {
    const { POST } = await routeModulePromise;

    // Non-duplicate error — the DrizzleQueryError message includes the profile
    // name "unique tools" in the SQL params text.
    createComposioToolProfileError = new Error(
      'Failed query: insert into "composio_tool_profiles" values ($1)\nparams: unique tools',
    );

    const response = await POST(
      request("POST", {
        name: "unique tools",
        toolkitSlugs: ["github"],
        authConfigIdsByToolkit: {},
        connectedAccountIdsByToolkit: {},
        workbenchEnabled: false,
        allowInChatConnectionManagement: false,
      }),
    );

    const body = (await response.json()) as { error: string };

    // Must NOT be 409 — the error is not a real unique constraint violation.
    expect(response.status).toBe(400);
    expect(body.error).toBe("Failed to save Composio profile.");
  });

  // BUG 2: PATCH with duplicate name must return 409 with realistic DrizzleQueryError shape.
  test("PATCH with duplicate profile name (DrizzleQueryError via cause.code 23505) returns 409", async () => {
    const { PATCH } = await routeModulePromise;

    const pgError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "composio_tool_profiles_user_id_name_unique"',
      ),
      { code: "23505" },
    );
    const drizzleError = Object.assign(
      new Error(
        'Failed query: update "composio_tool_profiles" set name = $1 where user_id = $2 and id = $3\nparams: GitHub,user-1,profile-2',
      ),
      { cause: pgError },
    );
    updateComposioToolProfileError = drizzleError;

    const response = await PATCH(
      request("PATCH", {
        profileId: "profile-2",
        profile: {
          name: "GitHub",
        },
      }),
    );

    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("A profile with that name already exists.");
  });

  // BUG 1 (generic error): POST with a non-duplicate server error returns 400 with generic message
  test("POST with generic server error returns 400 with generic message, not raw error", async () => {
    const { POST } = await routeModulePromise;

    createComposioToolProfileError = new Error("boom");

    const response = await POST(
      request("POST", {
        name: "MyProfile",
        toolkitSlugs: ["github"],
        authConfigIdsByToolkit: {},
        connectedAccountIdsByToolkit: {},
        workbenchEnabled: false,
        allowInChatConnectionManagement: false,
      }),
    );

    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
