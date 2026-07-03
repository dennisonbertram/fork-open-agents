import { beforeEach, describe, expect, mock, test } from "bun:test";

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
let savedSettings: unknown;

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

// ── Toolkit catalog mock (#799, finding B3) — used to validate
// blockedToolkitSlugs against known toolkits, mirroring the toolkits route's
// own catalog source (composio.toolkits.get). Configurable per-test so both
// the happy path and the catalog-lookup-failure path can be exercised.
let toolkitCatalogThrows: Error | null = null;
const toolkitCatalogItems = [
  { slug: "github", name: "GitHub" },
  { slug: "gmail", name: "Gmail" },
  { slug: "slack", name: "Slack" },
];

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test_key" }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    toolkits: {
      get: async () => {
        if (toolkitCatalogThrows) {
          throw toolkitCatalogThrows;
        }
        return { items: toolkitCatalogItems };
      },
    },
  }),
}));

mock.module("@/lib/db/composio", () => ({
  listComposioToolProfiles: async () => [profile],
  getComposioAgentDefaults: async () => ({}),
  createComposioToolProfile: async () => ({}),
  updateComposioAgentDefaults: async () => ({}),
  updateComposioToolProfile: async () => ({}),
  deleteComposioToolProfile: async () => true,
  isComposioProfileAllowedForRepository: async () => ({
    allowed: true,
    reason: null,
  }),
  getRepositoryComposioSettings: async () => null,
  listComposioProfileOptionsForRepository: async () => ({
    profiles: [profile],
    profileOptions: [{ ...profile, available: true, disabledReason: null }],
    repositorySettings: savedSettings
      ? {
          id: "repo-policy-1",
          userId: "user-1",
          repoOwner: "dennisonbertram",
          repoName: "fork-open-agents",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          ...(savedSettings as Record<string, unknown>),
        }
      : null,
  }),
  upsertRepositoryComposioSettings: async (input: { settings: unknown }) => {
    savedSettings = input.settings;
    return {
      id: "repo-policy-1",
      userId: "user-1",
      repoOwner: "dennisonbertram",
      repoName: "fork-open-agents",
      inheritGlobalDefaults: false,
      allowedProfileIds: ["profile-1"],
      blockedToolkitSlugs: ["gmail"],
      agentDefaults: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  },
}));

const routeModulePromise = import("./route");

function context(repoOwner = "DennisonBertram", repoName = "Fork-Open-Agents") {
  return {
    params: Promise.resolve({ repoOwner, repoName }),
  };
}

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/settings/repositories/DennisonBertram/Fork-Open-Agents/composio",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("/api/settings/repositories/[repoOwner]/[repoName]/composio", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    savedSettings = null;
    toolkitCatalogThrows = null;
  });

  test("GET returns repo-scoped Composio policy options", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), context());
    const body = (await response.json()) as {
      repoOwner: string;
      repoName: string;
      profileOptions: Array<{ id: string; available: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(body.repoOwner).toBe("DennisonBertram");
    expect(body.repoName).toBe("Fork-Open-Agents");
    expect(body.profileOptions).toEqual([
      expect.objectContaining({ id: "profile-1", available: true }),
    ]);
  });

  test("PATCH saves repo-scoped allow and block policy", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request({
        inheritGlobalDefaults: false,
        allowedProfileIds: ["profile-1"],
        blockedToolkitSlugs: ["gmail"],
        agentDefaults: {},
      }),
      context(),
    );
    const body = (await response.json()) as {
      repositorySettings: { allowedProfileIds: string[] };
    };

    expect(response.status).toBe(200);
    expect(savedSettings).toMatchObject({
      inheritGlobalDefaults: false,
      allowedProfileIds: ["profile-1"],
      blockedToolkitSlugs: ["gmail"],
    });
    expect(body.repositorySettings.allowedProfileIds).toEqual(["profile-1"]);
  });

  test("PATCH rejects policies that reference unknown profiles", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request({
        inheritGlobalDefaults: false,
        allowedProfileIds: ["not-owned"],
        blockedToolkitSlugs: [],
        agentDefaults: {},
      }),
      context(),
    );

    expect(response.status).toBe(400);
  });

  // ── #799, finding B3: reject unknown blockedToolkitSlugs at save time ────────

  test("PATCH rejects an unrecognized blockedToolkitSlugs entry with 400 naming the slug", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request({
        inheritGlobalDefaults: true,
        allowedProfileIds: [],
        blockedToolkitSlugs: ["gmial"],
        agentDefaults: {},
      }),
      context(),
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("gmial");
    expect(savedSettings).toBeNull();
  });

  test("PATCH accepts blockedToolkitSlugs that exist in the toolkit catalog even if the user has never connected them", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request({
        inheritGlobalDefaults: true,
        allowedProfileIds: [],
        blockedToolkitSlugs: ["gmail"],
        agentDefaults: {},
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(savedSettings).toMatchObject({ blockedToolkitSlugs: ["gmail"] });
  });

  test("PATCH surfaces an explicit failure when the toolkit catalog lookup itself fails", async () => {
    toolkitCatalogThrows = new Error("Composio is unreachable");
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request({
        inheritGlobalDefaults: true,
        allowedProfileIds: [],
        blockedToolkitSlugs: ["gmail"],
        agentDefaults: {},
      }),
      context(),
    );

    // Must not silently accept an unvalidated slug — the catalog lookup
    // failure itself must be a visible, explicit error, not a 200.
    expect(response.status).toBe(502);
    expect(savedSettings).toBeNull();
  });
});
