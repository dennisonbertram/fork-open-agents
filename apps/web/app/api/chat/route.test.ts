import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  cloneUrl: string;
  repoOwner: string;
  repoName: string;
  status: "running" | "archived";
  prNumber?: number | null;
  autoCommitPushOverride?: boolean | null;
  autoCreatePrOverride?: boolean | null;
  sandboxState: {
    type: "vercel";
  };
}

interface TestChatRecord {
  sessionId: string;
  modelId: string | null;
  activeStreamId: string | null;
}

let sessionRecord: TestSessionRecord | null;
let chatRecord: TestChatRecord | null;
let currentAuthSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    email?: string;
  };
} | null;
let isSandboxActive = true;
let existingRunStatus: string = "completed";
let getRunShouldThrow = false;
let claimActiveStreamDefaultResult = true;
let compareAndSetDefaultResult = true;
let compareAndSetResults: boolean[] = [];
let startCalls: unknown[][] = [];
let routeEvents: string[] = [];
let verifiedBuildRunCalls: unknown[] = [];
let verifiedBuildClassificationCalls: unknown[] = [];
let preferencesState: {
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  modelVariants: Array<{
    id: string;
    name: string;
    baseModelId: string;
    providerOptions: Record<string, unknown>;
  }>;
} = {
  autoCommitPush: true,
  autoCreatePr: false,
  modelVariants: [],
};
let cachedSkillsState: unknown = null;
let discoverSkillDirsCalls: string[][] = [];
let abandonedAssistantMessageIds: string[] = [];
let rateLimitResponse: Response | null = null;
let checkRateLimitCalls: Array<{
  key: string;
  limit: number;
  windowMs: number;
}> = [];

const claimChatActiveStreamIdSpy = mock(
  async () => claimActiveStreamDefaultResult,
);

const compareAndSetChatActiveStreamIdSpy = mock(async () => {
  const nextResult = compareAndSetResults.shift();
  return nextResult ?? compareAndSetDefaultResult;
});

const createChatMessageIfNotExistsSpy = mock(async ({ id }: { id: string }) => {
  routeEvents.push("persist-user");
  return { id };
});
const touchChatSpy = mock(async () => {
  routeEvents.push("touch-chat");
});
const isFirstChatMessageSpy = mock(async () => true);
const updateChatSpy = mock(async () => {
  routeEvents.push("update-chat");
});

const originalFetch = globalThis.fetch;
const originalVerifiedBuildExposure =
  process.env.OPEN_AGENTS_EXPOSE_VERIFIED_BUILD;

globalThis.fetch = (async (_input: RequestInfo | URL) => {
  return new Response("{}", {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}) as typeof fetch;

mock.module("next/server", () => ({
  after: (task: Promise<unknown>) => {
    void Promise.resolve(task);
  },
}));

mock.module("ai", () => ({
  createUIMessageStreamResponse: ({
    stream,
    headers,
  }: {
    stream: ReadableStream;
    headers?: Record<string, string>;
  }) => new Response(stream, { status: 200, headers }),
  isToolUIPart: (part: { type: string }) =>
    part.type.startsWith("tool-") || part.type === "dynamic-tool",
}));

mock.module("workflow/api", () => ({
  start: async (...args: unknown[]) => {
    routeEvents.push("start-workflow");
    startCalls.push(args);
    return {
      runId: "wrun_test-123",
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    };
  },
  getRun: () => {
    if (getRunShouldThrow) {
      throw new Error("Run not found");
    }

    return {
      status: Promise.resolve(existingRunStatus),
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      cancel: () => Promise.resolve(),
    };
  },
}));

mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow: async () => {},
}));

mock.module("@/lib/chat/create-cancelable-readable-stream", () => ({
  createCancelableReadableStream: (stream: ReadableStream) => stream,
}));

mock.module("@open-agents/agent", () => ({
  discoverSkills: async (_sandbox: unknown, skillDirs: string[]) => {
    discoverSkillDirsCalls.push(skillDirs);
    return [];
  },
  gateway: () => "mock-model",
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/vercel/sandbox",
    exec: async () => ({ success: true, stdout: "", stderr: "" }),
    getState: () => ({
      type: "vercel",
      sandboxId: "sandbox-1",
      expiresAt: Date.now() + 60_000,
    }),
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  getAbandonedAssistantMessageIds: async () => abandonedAssistantMessageIds,
  claimChatActiveStreamId: claimChatActiveStreamIdSpy,
  compareAndSetChatActiveStreamId: compareAndSetChatActiveStreamIdSpy,
  createChatMessageIfNotExists: createChatMessageIfNotExistsSpy,
  getChatById: async () => chatRecord,
  getSessionById: async () => sessionRecord,
  isFirstChatMessage: isFirstChatMessageSpy,
  touchChat: touchChatSpy,
  updateChat: updateChatSpy,
  updateChatActiveStreamId: async () => {},
  updateChatAssistantActivity: async () => {},
  updateSession: async (_sessionId: string, patch: Record<string, unknown>) =>
    patch,
  upsertChatMessageScoped: async () => ({ status: "inserted" as const }),
}));

mock.module("@/lib/harness/run-mapping", () => ({
  getVerifiedBuildRunByIdForUser: async () => null,
  getLatestVerifiedBuildRunForChat: async () => null,
  getVerifiedBuildEventsForRun: async () => [],
  startVerifiedBuildRun: async (input: unknown) => {
    verifiedBuildRunCalls.push(input);
    return {
      id: "vbrun-1",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      harnessRunId: "harness-run-1",
      mode: "verified_build",
      status: "accepted",
      tenantId: "tenant-1",
      projectId: "project-1",
      actorId: "user-1",
      idempotencyKey: "idem-1",
      intentSummary: "Fix the bug",
      selectionReason: "mutating_software_work",
      lastEventId: null,
      lastEventName: null,
      lastEventAt: null,
      planApprovalState: "not_required",
      pendingApprovalKind: null,
      finalReportArtifactId: null,
      goNoGo: "unknown",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
  },
  updateVerifiedBuildRunFromHarnessStatus: async () => {},
  toVerifiedBuildRunSnapshot: (run: unknown) => run,
  toVerifiedBuildEventSnapshot: (event: unknown) => event,
}));

mock.module("@/lib/verified-build/task-classifier", () => ({
  classifyVerifiedBuildTask: (messages: unknown) => {
    verifiedBuildClassificationCalls.push(messages);
    return {
      mode: "verified_build",
      reasonCode: "mutating_software_work",
      confidence: "high",
      summary: "Fix the bug",
    };
  },
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => preferencesState,
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => cachedSkillsState,
  setCachedSkills: async () => {},
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/sandbox/config", () => ({
  SANDBOX_SNAPSHOT_EXPIRATION_MS: 604_800_000,
  DEFAULT_SANDBOX_PORTS: [],
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => isSandboxActive,
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async (options: {
    key: string;
    limit: number;
    windowMs: number;
  }) => {
    checkRateLimitCalls.push(options);
    return rateLimitResponse;
  },
  rateLimitKey: (parts: Array<number | string | null | undefined>) =>
    parts.map((part) => String(part ?? "unknown")).join(":"),
}));

const routeModulePromise = import("./route");

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalVerifiedBuildExposure === undefined) {
    delete process.env.OPEN_AGENTS_EXPOSE_VERIFIED_BUILD;
  } else {
    process.env.OPEN_AGENTS_EXPOSE_VERIFIED_BUILD =
      originalVerifiedBuildExposure;
  }
});

function createRequest(body: string, url = "http://localhost/api/chat") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "session=abc",
    },
    body,
  });
}

function createValidRequest() {
  return createRequest(
    JSON.stringify({
      sessionId: "session-1",
      chatId: "chat-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Fix the bug" }],
        },
      ],
    }),
  );
}

describe("/api/chat route", () => {
  beforeEach(() => {
    isSandboxActive = true;
    existingRunStatus = "completed";
    getRunShouldThrow = false;
    claimActiveStreamDefaultResult = true;
    compareAndSetDefaultResult = true;
    compareAndSetResults = [];
    startCalls = [];
    routeEvents = [];
    verifiedBuildRunCalls = [];
    verifiedBuildClassificationCalls = [];
    delete process.env.OPEN_AGENTS_EXPOSE_VERIFIED_BUILD;
    cachedSkillsState = null;
    discoverSkillDirsCalls = [];
    abandonedAssistantMessageIds = [];
    rateLimitResponse = null;
    checkRateLimitCalls = [];
    preferencesState = {
      autoCommitPush: true,
      autoCreatePr: false,
      modelVariants: [],
    };
    claimChatActiveStreamIdSpy.mockClear();
    compareAndSetChatActiveStreamIdSpy.mockClear();
    createChatMessageIfNotExistsSpy.mockClear();
    touchChatSpy.mockClear();
    isFirstChatMessageSpy.mockClear();
    updateChatSpy.mockClear();
    currentAuthSession = {
      user: {
        id: "user-1",
      },
    };

    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session title",
      status: "running",
      cloneUrl: "https://github.com/acme/repo.git",
      repoOwner: "acme",
      repoName: "repo",
      prNumber: null,
      autoCommitPushOverride: null,
      autoCreatePrOverride: null,
      sandboxState: {
        type: "vercel",
      },
    };

    chatRecord = {
      sessionId: "session-1",
      modelId: null,
      activeStreamId: null,
    };
  });

  test("starts a workflow and returns a streaming response", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
  });

  test("routes mutating prompts through Verified Build when harness is enabled", async () => {
    const previousEnv = {
      HARNESS_ENABLED: process.env.HARNESS_ENABLED,
      HARNESS_BASE_URL: process.env.HARNESS_BASE_URL,
      HARNESS_SERVICE_TOKEN: process.env.HARNESS_SERVICE_TOKEN,
      HARNESS_TENANT_ID: process.env.HARNESS_TENANT_ID,
      HARNESS_DEFAULT_PROJECT_ID: process.env.HARNESS_DEFAULT_PROJECT_ID,
    };
    Object.assign(process.env, {
      HARNESS_ENABLED: "true",
      HARNESS_BASE_URL: "http://localhost:4318",
      HARNESS_SERVICE_TOKEN: "service-token",
      HARNESS_TENANT_ID: "tenant-1",
      HARNESS_DEFAULT_PROJECT_ID: "project-1",
      OPEN_AGENTS_EXPOSE_VERIFIED_BUILD: "true",
    });

    try {
      const { POST } = await routeModulePromise;
      const response = await POST(createValidRequest());

      expect(response.ok).toBe(true);
      expect(response.headers.get("x-verified-build-run-id")).toBe("vbrun-1");
      expect(startCalls).toHaveLength(0);
      expect(verifiedBuildRunCalls).toHaveLength(1);
      expect(verifiedBuildRunCalls[0]).toMatchObject({
        input: {
          sessionId: "session-1",
          chatId: "chat-1",
          latestUserMessageId: "user-1",
          mode: "verified_build",
        },
      });
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("keeps default chat direct when harness capability is enabled but product exposure is off", async () => {
    const previousEnv = {
      HARNESS_ENABLED: process.env.HARNESS_ENABLED,
      HARNESS_BASE_URL: process.env.HARNESS_BASE_URL,
      HARNESS_SERVICE_TOKEN: process.env.HARNESS_SERVICE_TOKEN,
      HARNESS_TENANT_ID: process.env.HARNESS_TENANT_ID,
      HARNESS_DEFAULT_PROJECT_ID: process.env.HARNESS_DEFAULT_PROJECT_ID,
    };
    Object.assign(process.env, {
      HARNESS_ENABLED: "true",
      HARNESS_BASE_URL: "http://localhost:4318",
      HARNESS_SERVICE_TOKEN: "service-token",
      HARNESS_TENANT_ID: "tenant-1",
      HARNESS_DEFAULT_PROJECT_ID: "project-1",
    });
    delete process.env.OPEN_AGENTS_EXPOSE_VERIFIED_BUILD;

    try {
      const { POST } = await routeModulePromise;
      const response = await POST(createValidRequest());

      expect(response.ok).toBe(true);
      expect(response.headers.get("x-verified-build-run-id")).toBeNull();
      expect(startCalls).toHaveLength(1);
      expect(verifiedBuildClassificationCalls).toHaveLength(0);
      expect(verifiedBuildRunCalls).toHaveLength(0);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("returns 400 for archived sessions without starting a workflow", async () => {
    if (!sessionRecord) {
      throw new Error("sessionRecord must be set");
    }
    sessionRecord.status = "archived";
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Session is archived",
      errorKind: "invalid_request",
    });
    expect(startCalls).toHaveLength(0);
    expect(createChatMessageIfNotExistsSpy).not.toHaveBeenCalled();
  });

  test("persists the latest user message before starting the workflow", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(createChatMessageIfNotExistsSpy).toHaveBeenCalledWith({
      id: "user-1",
      chatId: "chat-1",
      role: "user",
      parts: expect.objectContaining({ id: "user-1", role: "user" }),
    });
    expect(routeEvents.indexOf("persist-user")).toBeGreaterThanOrEqual(0);
    expect(routeEvents.indexOf("start-workflow")).toBeGreaterThan(
      routeEvents.indexOf("persist-user"),
    );
  });

  test("passes the 500 maxSteps limit to the workflow", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.objectContaining({
        maxSteps: 500,
        requestUrl: "http://localhost/api/chat",
        authSession: currentAuthSession,
      }),
    ]);
  });

  test("defers selected model resolution to the workflow", async () => {
    const { POST } = await routeModulePromise;
    if (!chatRecord) {
      throw new Error("chatRecord must be set");
    }

    chatRecord.modelId = "variant:test-model";
    preferencesState.modelVariants = [
      {
        id: "variant:test-model",
        name: "Test model",
        baseModelId: "openai/gpt-5",
        providerOptions: {},
      },
    ];

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        selectedModelId: expect.anything(),
        modelId: expect.anything(),
      }),
    ]);
  });

  test("does not connect to the sandbox before starting the workflow", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(discoverSkillDirsCalls).toEqual([]);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        agentOptions: expect.anything(),
      }),
    ]);
  });

  test("passes autoCreatePrEnabled when auto commit and auto PR are enabled", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCreatePr = true;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
      }),
    ]);
  });

  test("keeps auto PR enabled when the session already has PR metadata", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCreatePr = true;
    if (!sessionRecord) {
      throw new Error("sessionRecord must be set");
    }
    sessionRecord.prNumber = 42;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
      }),
    ]);
  });

  test("does not enable auto PR when auto commit is disabled", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCommitPush = false;
    preferencesState.autoCreatePr = true;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        autoCommitEnabled: true,
      }),
    ]);
  });

  test("returns 401 when not authenticated", async () => {
    currentAuthSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });

  test("returns 400 for invalid JSON body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
  });

  test("returns 400 when sessionId and chatId are missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest(
        JSON.stringify({
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Fix the bug" }],
            },
          ],
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "sessionId and chatId are required",
    });
  });

  test("returns 404 when session does not exist", async () => {
    sessionRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Session not found",
    });
  });

  test("returns 403 when session is not owned by user", async () => {
    if (!sessionRecord) {
      throw new Error("sessionRecord must be set");
    }
    sessionRecord.userId = "user-2";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  test("starts a workflow when sandbox is not active", async () => {
    isSandboxActive = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
  });

  test("reconnects to existing running workflow instead of starting new one", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_existing-456";
    existingRunStatus = "running";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_existing-456");
    expect(startCalls).toHaveLength(0);
    expect(createChatMessageIfNotExistsSpy).not.toHaveBeenCalled();
    expect(compareAndSetChatActiveStreamIdSpy).not.toHaveBeenCalled();
  });

  test("starts new workflow when existing run is completed and clears the stale stream id first", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_old-789";
    existingRunStatus = "completed";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");

    const compareAndSetCalls = compareAndSetChatActiveStreamIdSpy.mock
      .calls as unknown[][];
    expect(compareAndSetCalls).toEqual([["chat-1", "wrun_old-789", null]]);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
      // #1269: the browser route claims the slot as a "browser" run.
      "browser",
    );
  });

  test("starts new workflow when the existing run cannot be loaded and clears the stale stream id first", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_missing-789";
    getRunShouldThrow = true;

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");

    const compareAndSetCalls = compareAndSetChatActiveStreamIdSpy.mock
      .calls as unknown[][];
    expect(compareAndSetCalls).toEqual([["chat-1", "wrun_missing-789", null]]);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
      // #1269: the browser route claims the slot as a "browser" run.
      "browser",
    );
  });

  test("succeeds when the started workflow already claimed the stream slot", async () => {
    compareAndSetDefaultResult = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
      // #1269: the browser route claims the slot as a "browser" run.
      "browser",
    );
  });

  test("returns 409 when a different workflow owns the stream slot", async () => {
    claimActiveStreamDefaultResult = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Another workflow is already running for this chat",
      errorKind: "conflict",
    });
  });

  test("includes x-workflow-run-id header on success", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");
  });

  test("checks the chat rate limit for the authenticated user with a 30/min ceiling", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(checkRateLimitCalls).toHaveLength(1);
    expect(checkRateLimitCalls[0]).toEqual({
      key: "chat:user-1",
      limit: 30,
      windowMs: 60_000,
    });
  });

  test("returns the rate limit response without starting a workflow when limited", async () => {
    rateLimitResponse = Response.json(
      { error: "Too many requests", errorKind: "rate_limited" },
      { status: 429 },
    );
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(429);
    expect(startCalls).toHaveLength(0);
    expect(createChatMessageIfNotExistsSpy).not.toHaveBeenCalled();
  });

  // Issue #1133 / PR #1134 review. Same open chat, no reload: the client
  // re-posts its own copy of the failed assistant turn, which never received
  // `metadata.abandoned` because the live stream only carries text chunks.
  // The server must re-derive the flag from the persisted row before the
  // workflow builds the model-facing history, otherwise the abandoned request
  // is silently resumed by the next unrelated message.
  test("restores the persisted abandoned flag onto client-supplied history", async () => {
    abandonedAssistantMessageIds = ["assistant-1"];
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest(
        JSON.stringify({
          sessionId: "session-1",
          chatId: "chat-1",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [
                { type: "text", text: "please read github access tools" },
              ],
            },
            {
              id: "assistant-1",
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "Workspace setup failed. Try again in a moment.",
                },
              ],
            },
            {
              id: "user-2",
              role: "user",
              parts: [{ type: "text", text: "Hi here is the second turn." }],
            },
          ],
        }),
      ),
    );

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    const [workflowInput] = (startCalls[0]?.[1] ?? []) as [
      { messages: WebAgentUIMessage[] },
    ];
    const assistantMessage = workflowInput.messages.find(
      (message) => message.id === "assistant-1",
    );

    expect(assistantMessage?.metadata?.abandoned).toBe(true);
    // New user input is never rewritten by this fix.
    expect(
      workflowInput.messages.find((message) => message.id === "user-2"),
    ).toEqual({
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Hi here is the second turn." }],
    });
  });

  test("leaves client-supplied history untouched when nothing was abandoned", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    const [workflowInput] = (startCalls[0]?.[1] ?? []) as [
      { messages: WebAgentUIMessage[] },
    ];

    expect(workflowInput.messages).toEqual([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Fix the bug" }],
      },
    ]);
  });
});
