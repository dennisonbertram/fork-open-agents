import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";
import type { VercelProjectSelection } from "@/lib/vercel/types";

let currentSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    username: string;
    name: string;
    email?: string;
  };
} | null = {
  user: {
    id: "user-1",
    username: "nico",
    name: "Nico",
  },
};
let savedLink: VercelProjectSelection | null = null;
let currentVercelToken: string | null = "vercel-token";
let matchingProjects: VercelProjectSelection[] = [];
let matchingProjectsError: Error | null = null;
const createCalls: Array<Record<string, unknown>> = [];
const initialChatCalls: Array<Record<string, unknown>> = [];
const upsertCalls: Array<Record<string, unknown>> = [];
const prewarmKickCalls: Array<Record<string, unknown>> = [];
let composioPolicy = { allowed: true, reason: null as string | null };

// Mock resolveRepoDefaults so existing tests are not affected by the new
// repo-defaults lookup added in P4. The mock returns values that match the
// user-preferences mock above (autoCommitPush/autoCreatePr: false,
// managedRuntimeProfileId: "web-bun-agent-browser") so that tests written
// against preferences-layer behavior continue to pass without change.
mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async () => ({
    autoCommitPush: false,
    autoCreatePr: false,
    managedRuntimeProfileId: "web-bun-agent-browser",
    runtimeMode: "classic",
    vcpus: 2,
    fullClone: false,
    prewarmEnabled: false,
    defaultBranch: null,
    isNewBranch: false,
  }),
  mergeRepoDefaults: () => ({
    autoCommitPush: false,
    autoCreatePr: false,
    managedRuntimeProfileId: "web-bun-agent-browser",
    runtimeMode: "classic",
    vcpus: 2,
    fullClone: false,
    prewarmEnabled: false,
    defaultBranch: null,
    isNewBranch: false,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/botid", () => ({
  checkBotProtection: async () => ({ isBot: false }),
}));

mock.module("@/lib/sandbox/prewarm-kick", () => ({
  kickSandboxPrewarmWorkflow: (input: Record<string, unknown>) => {
    prewarmKickCalls.push(input);
  },
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: Array<number | string | null | undefined>) =>
    parts.filter((part) => part !== null && part !== undefined).join(":"),
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultInferenceProfileId: "inference-profile-1",
    defaultSandboxType: "vercel",
    defaultManagedRuntimeProfileId: "web-bun-agent-browser",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    modelVariants: [],
    enabledModelIds: [],
    composioAgentDefaults: {
      ...defaultComposioAgentDefaults,
      main: {
        defaultProfileId: "profile-main",
        allowChatOverride: true,
      },
    },
  }),
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => savedLink,
  upsertVercelProjectLink: async (input: Record<string, unknown>) => {
    upsertCalls.push(input);
  },
}));

mock.module("@/lib/db/composio", () => ({
  listComposioToolProfiles: async () => [],
  listComposioProfileOptionsForRepository: async () => ({
    profiles: [],
    profileOptions: [],
    repositorySettings: null,
  }),
  getComposioAgentDefaults: async () => ({}),
  createComposioToolProfile: async () => ({}),
  updateComposioAgentDefaults: async () => ({}),
  updateComposioToolProfile: async () => ({}),
  deleteComposioToolProfile: async () => true,
  getRepositoryComposioSettings: async () => null,
  upsertRepositoryComposioSettings: async () => ({}),
  isComposioProfileAllowedForRepository: async () => composioPolicy,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => currentVercelToken,
}));

mock.module("@/lib/vercel/projects", () => ({
  isVercelInvalidTokenError: (error: unknown) =>
    matchingProjectsError !== null && error === matchingProjectsError,
  listMatchingVercelProjects: async () => {
    if (matchingProjectsError) {
      throw matchingProjectsError;
    }
    return matchingProjects;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  updateChat: async () => null,
  getChatMessages: async () => [],
  getChatsBySessionId: async () => [],
  deleteChat: async () => undefined,
  getChatSummariesBySessionId: async () => [],
  getChatById: async () => null,
  createChat: async () => null,
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
        title: String(input.initialChat.title),
        modelId: String(input.initialChat.modelId),
        inferenceProfileId: input.initialChat.inferenceProfileId,
        composioSelection: input.initialChat.composioSelection,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
  getArchivedSessionCountByUserId: async () => 0,
  deleteSession: async () => undefined,
  getSessionById: async () => null,
  getSessionsWithUnreadByUserId: async () => [],
  getUsedSessionTitles: async () => new Set<string>(),
  updateSession: async () => null,
}));

const routeModulePromise = import("./route");

function createJsonRequest(
  body: unknown,
  url = "http://localhost/api/sessions",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions POST vercel project linking", () => {
  beforeEach(() => {
    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
      },
    };
    savedLink = null;
    currentVercelToken = "vercel-token";
    matchingProjects = [];
    matchingProjectsError = null;
    createCalls.length = 0;
    initialChatCalls.length = 0;
    upsertCalls.length = 0;
    prewarmKickCalls.length = 0;
    composioPolicy = { allowed: true, reason: null };
  });

  test("explicit Vercel project is validated against live repo matches before it is persisted", async () => {
    const { POST } = await routeModulePromise;

    const vercelProject: VercelProjectSelection = {
      projectId: "project-1",
      projectName: "tampered-name",
      teamId: "team-x",
      teamSlug: "tampered-team",
    };
    matchingProjects = [
      {
        projectId: "project-1",
        projectName: "app",
        teamId: "team-1",
        teamSlug: "acme",
      },
    ];

    const response = await POST(
      createJsonRequest({
        repoOwner: "Vercel",
        repoName: "Open-Harness",
        branch: "main",
        cloneUrl: "https://github.com/Vercel/Open-Harness",
        vercelProject,
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toEqual([
      {
        userId: "user-1",
        repoOwner: "Vercel",
        repoName: "Open-Harness",
        project: matchingProjects[0],
      },
    ]);
    expect(createCalls[0]).toMatchObject({
      repoOwner: "Vercel",
      repoName: "Open-Harness",
      vercelProjectId: "project-1",
      vercelProjectName: "app",
      vercelTeamId: "team-1",
      vercelTeamSlug: "acme",
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
    expect(body.session.vercelProjectId).toBe("project-1");
    expect(body.session.vercelProjectName).toBe("app");
  });

  test("rejects explicit Vercel projects that are not a live match for the repo", async () => {
    const { POST } = await routeModulePromise;

    matchingProjects = [
      {
        projectId: "project-2",
        projectName: "dashboard",
        teamId: null,
        teamSlug: null,
      },
    ];

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
        vercelProject: {
          projectId: "project-999",
          projectName: "rogue-project",
          teamId: null,
          teamSlug: null,
        },
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Selected Vercel project no longer matches this repository",
    );
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(0);
  });

  test("omitting vercelProject falls back to the saved repo link", async () => {
    const { POST } = await routeModulePromise;

    savedLink = {
      projectId: "project-2",
      projectName: "dashboard",
      teamId: null,
      teamSlug: null,
    };

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls[0]).toMatchObject({
      vercelProjectId: "project-2",
      vercelProjectName: "dashboard",
      vercelTeamId: null,
      vercelTeamSlug: null,
    });
    expect(body.session.vercelProjectName).toBe("dashboard");
  });

  test("explicit null suppresses Vercel linking for that session", async () => {
    const { POST } = await routeModulePromise;

    savedLink = {
      projectId: "project-2",
      projectName: "dashboard",
      teamId: null,
      teamSlug: null,
    };

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
        vercelProject: null,
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls[0]).toMatchObject({
      vercelProjectId: null,
      vercelProjectName: null,
      vercelTeamId: null,
      vercelTeamSlug: null,
    });
    expect(body.session.vercelProjectId).toBeNull();
  });

  test("new sessions snapshot the user global skill refs", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });
  });

  test("new sessions seed the initial chat from the main Composio default", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      chat: { composioSelection: unknown };
    };

    expect(response.status).toBe(200);
    expect(body.chat.composioSelection).toEqual({
      mainProfileId: "profile-main",
    });
  });

  test("new sessions turn Composio off when repo policy blocks the default", async () => {
    composioPolicy = {
      allowed: false,
      reason: "Blocked by repository policy.",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      chat: { composioSelection: unknown };
    };

    expect(response.status).toBe(200);
    expect(body.chat.composioSelection).toEqual({
      mainProfileId: null,
    });
  });

  test("rejects invalid repository owners", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: 'vercel" && echo nope && "',
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid repository owner");
    expect(createCalls).toHaveLength(0);
  });

  test("persists autoCreatePr when autoCommitPush is enabled", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "feature/auto-pr",
        cloneUrl: "https://github.com/vercel/open-agents",
        autoCommitPush: true,
        autoCreatePr: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      autoCommitPushOverride: true,
      autoCreatePrOverride: true,
    });
  });

  test("new sessions seed the session and initial chat from the default inference profile", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
      chat: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      inferenceProfileId: "inference-profile-1",
    });
    expect(initialChatCalls[0]).toMatchObject({
      inferenceProfileId: "inference-profile-1",
    });
    expect(body.session.inferenceProfileId).toBe("inference-profile-1");
    expect(body.chat.inferenceProfileId).toBe("inference-profile-1");
  });

  // Regression tests for issue #182 — session title from UI
  test("regression #182: a non-empty title in the POST body is used instead of the random-city fallback", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        title: "  My Sprint Session  ",
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    // The session title must be the user-supplied value (trimmed), NOT "Oslo"
    // which is what the mocked getRandomCityName returns.
    expect(body.session.title).toBe("My Sprint Session");
    expect(createCalls[0]).toMatchObject({ title: "My Sprint Session" });
  });

  test("regression #182: an empty title in the POST body falls back to the random-city name", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        title: "   ",
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    // Whitespace-only title must fall back to the random-city name.
    expect(body.session.title).toBe("Oslo");
    expect(createCalls[0]).toMatchObject({ title: "Oslo" });
  });
});

// BT-001, BT-002, BT-003
describe("/api/sessions POST no-repo sandbox-free creation", () => {
  beforeEach(() => {
    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
      },
    };
    savedLink = null;
    currentVercelToken = "vercel-token";
    matchingProjects = [];
    matchingProjectsError = null;
    createCalls.length = 0;
    initialChatCalls.length = 0;
    upsertCalls.length = 0;
    prewarmKickCalls.length = 0;
    composioPolicy = { allowed: true, reason: null };
  });

  // BT-001: No-repo create must NOT enter provisioning lifecycle
  test("no-repo (New Chat) create does NOT set lifecycleState to provisioning", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({}));

    expect(response.status).toBe(200);
    // lifecycleState must NOT be "provisioning" for a sandbox-free session
    expect(createCalls[0]).not.toMatchObject({
      lifecycleState: "provisioning",
    });
    // It should be null (no lifecycle) to avoid perpetual provisioning
    expect(createCalls[0]?.lifecycleState).toBeNull();
  });

  // BT-002: No-repo create must NOT provision a sandbox (sandboxState must be null)
  test("no-repo (New Chat) create does NOT set sandboxState", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({}));

    expect(response.status).toBe(200);
    // sandboxState must be null for a no-repo session — no sandbox provisioned
    expect(createCalls[0]?.sandboxState).toBeNull();
  });

  // BT-003: Repo-backed sessions still enter provisioning (unchanged behavior)
  test("repo-backed create still enters provisioning lifecycle (no regression)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );

    expect(response.status).toBe(200);
    // Repo-backed sessions must still enter provisioning so the sandbox lifecycle kicks in
    expect(createCalls[0]).toMatchObject({
      lifecycleState: "provisioning",
      sandboxState: { type: "vercel" },
    });
  });

  // REGRESSION-001: The API response body itself must reflect the null lifecycle for no-repo sessions
  test("no-repo session response body has null lifecycleState and null sandboxState", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({}));
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    // If the implementation regresses (back to hardcoded "provisioning"),
    // these assertions will fail and catch the breakage.
    expect(body.session.lifecycleState).toBeNull();
    expect(body.session.sandboxState).toBeNull();
  });

  // REGRESSION-002: Partial repo input (only repoOwner, no repoName) also stays sandbox-free
  test("session with repoOwner but no repoName does not enter provisioning", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ repoOwner: "vercel" }));

    expect(response.status).toBe(200);
    // hasRepo requires BOTH repoOwner AND repoName; partial input must not trigger provisioning
    expect(createCalls[0]?.lifecycleState).toBeNull();
    expect(createCalls[0]?.sandboxState).toBeNull();
  });

  // REGRESSION-003: Repo-backed session response body confirms provisioning (catches accidental no-op)
  test("repo-backed session response body has provisioning lifecycleState and vercel sandboxState", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    // If the implementation accidentally disabled provisioning for repo sessions,
    // this catches it.
    expect(body.session.lifecycleState).toBe("provisioning");
    expect(body.session.sandboxState).toEqual({ type: "vercel" });
  });
});
