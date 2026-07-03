/**
 * Regression tests for P4 session-route precedence changes.
 *
 * These tests catch specific failure modes that would occur if the
 * resolveRepoDefaults integration in route.ts were reverted or broken:
 *
 * - RG-P4-001: no-repo session must NOT call resolveRepoDefaults (DB cost)
 * - RG-P4-002: body override must win over repo defaults (not be ignored)
 * - RG-P4-003: runtimeMode must be set on session row (was absent before P4)
 * - RG-P4-004: autoCreatePr cross-field invariant still enforced when using
 *              repo defaults (not just body or prefs)
 * - RG-P4-005: resolveRepoDefaults is called with correct userId/owner/repo
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";

// ── Mutable state ──────────────────────────────────────────────────────────────
let currentSession = {
  user: { id: "user-reg", username: "reg", name: "Reg" },
};
const createCalls: Array<Record<string, unknown>> = [];
let resolveCallArgs: Array<{
  userId: string;
  repoOwner: string;
  repoName: string;
}> = [];

let mockResolvedDefaults = {
  autoCommitPush: true,
  autoCreatePr: true,
  managedRuntimeProfileId: "repo-reg-profile",
  runtimeMode: "managed_runtime" as const,
  vcpus: 2,
  fullClone: false,
  prewarmEnabled: false,
  defaultBranch: null,
  isNewBranch: false,
};

// ── Mocks ──────────────────────────────────────────────────────────────────────
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
  rateLimitKey: (parts: Array<string | number | null | undefined>) =>
    parts.filter((p) => p != null).join(":"),
}));
mock.module("@/lib/random-city", () => ({ getRandomCityName: () => "Tokyo" }));
mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "model",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: null,
    defaultSandboxType: "vercel",
    defaultManagedRuntimeProfileId: "user-pref-profile",
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
mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async (params: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }) => {
    resolveCallArgs.push(params);
    return mockResolvedDefaults;
  },
  mergeRepoDefaults: () => mockResolvedDefaults,
}));
// MR-4 (#812): the real module has `import "server-only"` and would throw
// under bun:test's client-module guard if left unmocked.
mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  isKnownManagedRuntimeProfileReference: async () => true,
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
  getUserVercelToken: async () => null,
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
    return {
      session: {
        ...input.session,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      chat: {
        id: "c1",
        sessionId: "s1",
        title: "New chat",
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

function post(body: unknown) {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const repoBody = {
  repoOwner: "acme",
  repoName: "api",
  cloneUrl: "https://github.com/acme/api",
  branch: "main",
};

describe("P4 regression — session-route precedence", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-reg", username: "reg", name: "Reg" } };
    createCalls.length = 0;
    resolveCallArgs.length = 0;
    mockResolvedDefaults = {
      autoCommitPush: true,
      autoCreatePr: true,
      managedRuntimeProfileId: "repo-reg-profile",
      runtimeMode: "managed_runtime",
      vcpus: 2,
      fullClone: false,
      prewarmEnabled: false,
      defaultBranch: null,
      isNewBranch: false,
    };
  });

  // RG-P4-001: If the code is reverted to not call resolveRepoDefaults,
  // a no-repo session would still read it (wrong) or a repo session would
  // not call it. This ensures no-repo never calls it.
  test("RG-P4-001: no-repo session never calls resolveRepoDefaults", async () => {
    const { POST } = await routeModulePromise;
    await POST(post({}));
    expect(resolveCallArgs).toHaveLength(0);
  });

  // RG-P4-002: If the precedence is inverted (repo defaults always win over body),
  // this test catches it: body autoCommitPush:false must beat resolved true.
  test("RG-P4-002: body autoCommitPush:false overrides resolved default of true", async () => {
    const { POST } = await routeModulePromise;
    await POST(post({ ...repoBody, autoCommitPush: false }));
    expect(createCalls[0]?.autoCommitPushOverride).toBe(false);
  });

  // RG-P4-003: runtimeMode column on the session row was absent before P4.
  // If the implementation regresses to omitting it, sessions would use the
  // DB column default ("classic") even when repo settings say "managed_runtime".
  test("RG-P4-003: repo session has runtimeMode in the persisted row", async () => {
    const { POST } = await routeModulePromise;
    await POST(post({ ...repoBody }));
    expect(createCalls[0]).toHaveProperty("runtimeMode");
    expect(createCalls[0]?.runtimeMode).toBe("managed_runtime");
  });

  // RG-P4-004: autoCreatePr cross-field invariant must hold even when the
  // autoCommitPush false value comes from the resolved repo defaults, not just
  // from the request body or user preferences.
  test("RG-P4-004: autoCreatePr forced false when resolved autoCommitPush is false", async () => {
    const { POST } = await routeModulePromise;
    mockResolvedDefaults = {
      ...mockResolvedDefaults,
      autoCommitPush: false,
      autoCreatePr: true, // violates invariant — must be corrected
    };
    await POST(post({ ...repoBody }));
    expect(createCalls[0]?.autoCommitPushOverride).toBe(false);
    expect(createCalls[0]?.autoCreatePrOverride).toBe(false);
  });

  // RG-P4-005: resolveRepoDefaults must be called with the correct params.
  // If userId, repoOwner, or repoName are passed wrong, all derived defaults
  // would be for the wrong user/repo.
  test("RG-P4-005: resolveRepoDefaults called with correct userId, owner, repo", async () => {
    const { POST } = await routeModulePromise;
    await POST(post({ ...repoBody }));
    expect(resolveCallArgs).toHaveLength(1);
    expect(resolveCallArgs[0]).toEqual({
      userId: "user-reg",
      repoOwner: "acme",
      repoName: "api",
    });
  });

  // RG-P4-006: managedRuntimeProfileId falls back to user prefs for no-repo sessions
  // (resolver not called). Catches regression where no-repo always used "classic" profile.
  test("RG-P4-006: no-repo session uses user-pref managedRuntimeProfileId", async () => {
    const { POST } = await routeModulePromise;
    await POST(post({}));
    expect(createCalls[0]?.managedRuntimeProfileId).toBe("user-pref-profile");
  });
});
