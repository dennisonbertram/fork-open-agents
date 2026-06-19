/**
 * P4(a) behavioral tests — session-route precedence:
 *   request body > repo defaults > user preferences > system defaults
 *
 * Tests: BT-P4-001 through BT-P4-006
 *
 * These tests are written RED-first, before any implementation changes.
 * They will fail until route.ts is updated to call resolveRepoDefaults.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";

// ── Mutable state ──────────────────────────────────────────────────────────────
let currentSession: {
  user: { id: string; username: string; name: string };
} | null = {
  user: { id: "user-1", username: "nico", name: "Nico" },
};

const createCalls: Array<Record<string, unknown>> = [];
const initialChatCalls: Array<Record<string, unknown>> = [];

// ── Resolved repo defaults returned by mock ────────────────────────────────────
let mockResolvedRepoDefaults = {
  autoCommitPush: true,
  autoCreatePr: true,
  managedRuntimeProfileId: "repo-profile-id",
  runtimeMode: "managed_runtime" as "classic" | "managed_runtime",
  vcpus: 4,
  fullClone: true,
  prewarmEnabled: true,
  defaultBranch: "develop",
  isNewBranch: true,
};

let resolveRepoDefaultsCalled = false;

// ── Module mocks ───────────────────────────────────────────────────────────────
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/botid", () => ({
  checkBotProtection: async () => ({ isBot: false }),
}));

mock.module("@/lib/sandbox/prewarm-kick", () => ({
  kickSandboxPrewarmWorkflow: () => undefined,
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: Array<number | string | null | undefined>) =>
    parts.filter((p) => p !== null && p !== undefined).join(":"),
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

// User preferences: autoCommitPush/autoCreatePr false, managedRuntimeProfileId = pref-profile
mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: "inference-profile-1",
    defaultSandboxType: "vercel",
    defaultManagedRuntimeProfileId: "pref-profile-id",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [],
    modelVariants: [],
    enabledModelIds: [],
    composioAgentDefaults: {
      ...defaultComposioAgentDefaults,
      main: { defaultProfileId: null, allowChatOverride: true },
    },
  }),
}));

// resolveRepoDefaults mock: tracks call and returns configured defaults
mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async (_params: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }) => {
    resolveRepoDefaultsCalled = true;
    return mockResolvedRepoDefaults;
  },
  mergeRepoDefaults: () => mockResolvedRepoDefaults,
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => null,
  upsertVercelProjectLink: async () => undefined,
}));

mock.module("@/lib/db/composio", () => ({
  isComposioProfileAllowedForRepository: async () => ({
    allowed: true,
    reason: null,
  }),
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => "vercel-token",
}));

mock.module("@/lib/vercel/projects", () => ({
  isVercelInvalidTokenError: () => false,
  listMatchingVercelProjects: async () => [],
}));

mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat: async (input: {
    session: Record<string, unknown>;
    initialChat: Record<string, unknown>;
  }) => {
    createCalls.push(input.session);
    initialChatCalls.push(input.initialChat);
    return {
      session: {
        ...input.session,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      chat: {
        id: String(input.initialChat.id),
        sessionId: String(input.session.id),
        title: "New chat",
        modelId: String(input.initialChat.modelId),
        inferenceProfileId: input.initialChat.inferenceProfileId,
        composioSelection: input.initialChat.composioSelection,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
  getArchivedSessionCountByUserId: async () => 0,
  getSessionsWithUnreadByUserId: async () => [],
  getUsedSessionTitles: async () => new Set<string>(),
  updateSession: async () => null,
  deleteSession: async () => undefined,
  getSessionById: async () => null,
  getChatsBySessionId: async () => [],
  getChatById: async () => null,
  createChat: async () => null,
  updateChat: async () => null,
  getChatMessages: async () => [],
  deleteChat: async () => undefined,
  getChatSummariesBySessionId: async () => [],
}));

const routeModulePromise = import("./route");

function makePostRequest(
  body: unknown,
  url = "http://localhost/api/sessions",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Shared repo body ───────────────────────────────────────────────────────────
const repoBody = {
  repoOwner: "acme",
  repoName: "web",
  cloneUrl: "https://github.com/acme/web",
};

describe("P4(a) — session route resolves repo defaults", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1", username: "nico", name: "Nico" } };
    createCalls.length = 0;
    initialChatCalls.length = 0;
    resolveRepoDefaultsCalled = false;
    mockResolvedRepoDefaults = {
      autoCommitPush: true,
      autoCreatePr: true,
      managedRuntimeProfileId: "repo-profile-id",
      runtimeMode: "managed_runtime",
      vcpus: 4,
      fullClone: true,
      prewarmEnabled: true,
      defaultBranch: "develop",
      isNewBranch: true,
    };
  });

  // BT-P4-001: Repo-backed session uses resolved defaults when no body overrides provided
  test("BT-P4-001: repo-backed session seeds from resolveRepoDefaults when no body overrides", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      makePostRequest({ ...repoBody, branch: "main" }),
    );

    expect(response.status).toBe(200);
    expect(resolveRepoDefaultsCalled).toBe(true);
    // autoCommitPushOverride should come from resolved.autoCommitPush (true), not user pref (false)
    expect(createCalls[0]).toMatchObject({
      autoCommitPushOverride: true,
      autoCreatePrOverride: true,
      managedRuntimeProfileId: "repo-profile-id",
      runtimeMode: "managed_runtime",
    });
  });

  // BT-P4-002: Explicit body values override resolved repo defaults
  test("BT-P4-002: explicit body autoCommitPush:false overrides resolved default of true", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      makePostRequest({
        ...repoBody,
        branch: "main",
        autoCommitPush: false,
        autoCreatePr: false,
      }),
    );

    expect(response.status).toBe(200);
    // body says false — must win over resolved.autoCommitPush (true)
    expect(createCalls[0]).toMatchObject({
      autoCommitPushOverride: false,
      autoCreatePrOverride: false,
    });
  });

  // BT-P4-003: Explicit managedRuntimeProfileId in body overrides resolved default
  test("BT-P4-003: explicit body managedRuntimeProfileId overrides resolved default", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      makePostRequest({
        ...repoBody,
        branch: "main",
        managedRuntimeProfileId: "web-bun-agent-browser",
      }),
    );

    expect(response.status).toBe(200);
    // body provided managedRuntimeProfileId must win over repo default "repo-profile-id"
    expect(createCalls[0]).toMatchObject({
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
  });

  // BT-P4-004: No-repo session does NOT call resolveRepoDefaults and falls back to user prefs
  test("BT-P4-004: no-repo session does not call resolveRepoDefaults — uses user prefs", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(makePostRequest({}));

    expect(response.status).toBe(200);
    expect(resolveRepoDefaultsCalled).toBe(false);
    // Falls back to user pref managedRuntimeProfileId = "pref-profile-id"
    expect(createCalls[0]).toMatchObject({
      managedRuntimeProfileId: "pref-profile-id",
    });
  });

  // BT-P4-005: runtimeMode seeded from resolved defaults for repo sessions
  test("BT-P4-005: repo session runtimeMode is seeded from resolved defaults", async () => {
    const { POST } = await routeModulePromise;

    // Set resolved to managed_runtime
    mockResolvedRepoDefaults = {
      ...mockResolvedRepoDefaults,
      runtimeMode: "managed_runtime",
    };

    const response = await POST(
      makePostRequest({ ...repoBody, branch: "main" }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({ runtimeMode: "managed_runtime" });
  });

  // BT-P4-006: autoCreatePr forced false when effective autoCommitPush is false
  test("BT-P4-006: autoCreatePr forced false when effective autoCommitPush resolves false", async () => {
    const { POST } = await routeModulePromise;

    // Repo defaults: autoCommitPush=false, autoCreatePr=true (invariant must enforce false)
    mockResolvedRepoDefaults = {
      ...mockResolvedRepoDefaults,
      autoCommitPush: false,
      autoCreatePr: true, // resolver normally prevents this, but body path must also enforce it
    };

    const response = await POST(
      makePostRequest({ ...repoBody, branch: "main" }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      autoCommitPushOverride: false,
      autoCreatePrOverride: false, // must be forced false
    });
  });

  // BT-P4-007: isNewBranch seeded from resolved when not in body
  test("BT-P4-007: isNewBranch seeded from resolved defaults when body omits it", async () => {
    const { POST } = await routeModulePromise;

    // resolved.isNewBranch = true but body doesn't specify
    const response = await POST(
      makePostRequest({ ...repoBody, branch: "main" }),
    );

    expect(response.status).toBe(200);
    // isNewBranch from resolved = true triggers generateBranchName
    // so branch should be auto-generated (truthy)
    expect(createCalls[0]?.isNewBranch).toBe(true);
  });
});
