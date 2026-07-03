/**
 * Regression tests for MR-4 (#812) activation-path changes.
 *
 * These catch specific failure modes that would occur if the changes in
 * 00eef8eb (POST /api/sessions runtimeMode + managedRuntimeProfileId
 * activation) were reverted or broken:
 *
 * - REG-MR4-001: an unknown/foreign managedRuntimeProfileId must never reach
 *   createSessionWithInitialChat (fail-closed on the reference check).
 * - REG-MR4-002: an explicit runtimeMode:"classic" in the body must win over
 *   a repo default of "managed_runtime" (precedence: body > repo default).
 * - REG-MR4-003: creating a new managed_runtime session must NOT call any
 *   bulk/update path against other sessions — only one session insert
 *   happens, proving a Preferences default change can never auto-flip
 *   existing sessions via this route.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";

let currentSession = {
  user: { id: "user-mr4", username: "mr4", name: "MR4" },
};
const createCalls: Array<Record<string, unknown>> = [];
const updateSessionCalls: Array<Record<string, unknown>> = [];

let mockResolvedDefaults = {
  autoCommitPush: false,
  autoCreatePr: false,
  managedRuntimeProfileId: "repo-default-profile",
  runtimeMode: "managed_runtime" as "classic" | "managed_runtime",
  vcpus: 2,
  fullClone: false,
  prewarmEnabled: false,
  defaultBranch: null as string | null,
  isNewBranch: false,
};

let knownReferenceResult = true;

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
mock.module("@/lib/random-city", () => ({ getRandomCityName: () => "Kyoto" }));
mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "model",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: null,
    defaultSandboxType: "vercel",
    defaultManagedRuntimeProfileId: "web-bun-agent-browser",
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
  resolveRepoDefaults: async () => mockResolvedDefaults,
  mergeRepoDefaults: () => mockResolvedDefaults,
}));
mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  isKnownManagedRuntimeProfileReference: async () => knownReferenceResult,
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
        id: "chat-mr4",
        sessionId: String(input.session.id),
        title: "New chat",
        modelId: "model",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
  // If this route ever starts bulk-updating other sessions when a new
  // session is created, this mock records it so REG-MR4-003 can catch it.
  updateSession: async (id: string, updates: Record<string, unknown>) => {
    updateSessionCalls.push({ id, ...updates });
    return null;
  },
  getUsedSessionTitles: async () => new Set<string>(),
  getArchivedSessionCountByUserId: async () => 0,
  getSessionsWithUnreadByUserId: async () => [],
}));

const routeModulePromise = import("./route");

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("MR-4 (#812) regression — activation path", () => {
  beforeEach(() => {
    createCalls.length = 0;
    updateSessionCalls.length = 0;
    knownReferenceResult = true;
    mockResolvedDefaults = {
      autoCommitPush: false,
      autoCreatePr: false,
      managedRuntimeProfileId: "repo-default-profile",
      runtimeMode: "managed_runtime",
      vcpus: 2,
      fullClone: false,
      prewarmEnabled: false,
      defaultBranch: null,
      isNewBranch: false,
    };
  });

  test("REG-MR4-001: an unknown managedRuntimeProfileId never reaches createSessionWithInitialChat", async () => {
    knownReferenceResult = false;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        runtimeMode: "managed_runtime",
        managedRuntimeProfileId: "someone-elses-profile",
      }),
    );

    expect(response.status).toBe(400);
    // If the reference check were ever bypassed, this would be > 0.
    expect(createCalls).toHaveLength(0);
  });

  test("REG-MR4-002: explicit body runtimeMode:classic wins over a repo default of managed_runtime", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "acme",
        repoName: "widgets",
        branch: "main",
        cloneUrl: "https://github.com/acme/widgets",
        runtimeMode: "classic",
      }),
    );

    expect(response.status).toBe(200);
    // If precedence regresses to "repo default wins", this becomes
    // "managed_runtime" and the test fails.
    expect(createCalls[0]).toMatchObject({ runtimeMode: "classic" });
  });

  test("REG-MR4-003: creating a managed_runtime session never calls updateSession on any other session (no auto-flip)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        runtimeMode: "managed_runtime",
        managedRuntimeProfileId: "user-profile-abc",
      }),
    );

    expect(response.status).toBe(200);
    expect(createCalls).toHaveLength(1);
    // If a future change ever bulk-updates existing sessions to match a new
    // default, updateSessionCalls would be non-empty here.
    expect(updateSessionCalls).toHaveLength(0);
  });
});
