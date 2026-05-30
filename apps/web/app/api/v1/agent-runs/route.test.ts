import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
      token: {
        id: string;
        rateLimitMax: number;
        rateLimitWindowMs: number;
      };
      repositoryPolicy: { allowedRepositories: string[] | null };
    }
  | {
      ok: false;
      status: 401 | 403;
      code: string;
      message: string;
    };

let authResult: AuthResult;
let createRunReplay = false;
let createRunCalls: unknown[] = [];
let createSessionCalls: unknown[] = [];
let workflowStartCalls: unknown[][] = [];
let attachCalls: unknown[] = [];
let eventCalls: unknown[] = [];
let listCalls: unknown[] = [];
let failCalls: unknown[] = [];
let rateLimitResponse: Response | null = null;

const baseRun = {
  id: "arun_test",
  userId: "user-1",
  tokenId: "token-1",
  status: "accepted" as const,
  idempotencyKeyHash: null,
  requestId: "req-test",
  sessionId: null,
  chatId: null,
  workflowRunId: null,
  promptMessageId: "msg_test",
  resultMessageId: null,
  title: "API test",
  repository: null,
  runtimeMode: "managed_runtime" as const,
  managedRuntimeProfileId: "web-bun-agent-browser",
  modelId: "anthropic/claude-haiku-4.5",
  inferenceRoute: null,
  inferenceProfileId: null,
  sandboxName: null,
  failureKind: null,
  failureMessage: null,
  failureRetryable: null,
  metadata: {},
  startedAt: null,
  finishedAt: null,
  createdAt: new Date("2026-05-30T12:00:00.000Z"),
  updatedAt: new Date("2026-05-30T12:00:00.000Z"),
};

const verifyBearerApiToken = mock(async () => authResult);
const createAgentApiRun = mock(async (input: unknown) => {
  createRunCalls.push(input);
  return { run: baseRun, replayed: createRunReplay };
});
const createSessionChatAndMessageForApiRun = mock(async (input: unknown) => {
  createSessionCalls.push(input);
});
const attachAgentApiRunWorkflow = mock(async (input: unknown) => {
  attachCalls.push(input);
  return {
    ...baseRun,
    status: "running" as const,
    sessionId: "session_test",
    chatId: "chat_test",
    workflowRunId: "workflow_test",
  };
});
const recordApiRunEvent = mock(async (input: unknown) => {
  eventCalls.push(input);
});
const listAgentApiRunsForToken = mock(async (input: unknown) => {
  listCalls.push(input);
  return [baseRun];
});
const markAgentApiRunFailed = mock(async (input: unknown) => {
  failCalls.push(input);
});
const start = mock(async (...args: unknown[]) => {
  workflowStartCalls.push(args);
  return { runId: "workflow_test" };
});
const getAgentRunSnapshot = mock(async (run: typeof baseRun) => ({
  id: run.id,
  status: run.status,
  sessionId: run.sessionId,
  chatId: run.chatId,
  workflowRunId: run.workflowRunId,
  runtimeMode: run.runtimeMode,
  links: {
    status: `/api/v1/agent-runs/${run.id}`,
    events: `/api/v1/agent-runs/${run.id}/events`,
    messages: `/api/v1/agent-runs/${run.id}/messages`,
    proof: `/api/v1/agent-runs/${run.id}/proof`,
    cancel: `/api/v1/agent-runs/${run.id}/cancel`,
    ui: null,
  },
}));

mock.module("workflow/api", () => ({ start }));
mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow: async () => {},
}));
mock.module("@/lib/api-auth/tokens", () => ({
  hashIdempotencyKey: (key: string) => `hash:${key}`,
  verifyBearerApiToken,
}));
mock.module("@/lib/agent-api-runs/runs", () => ({
  attachAgentApiRunWorkflow,
  createAgentApiRun,
  createApiRunId: async () => "arun_test",
  createSessionChatAndMessageForApiRun,
  listAgentApiRunsForToken,
  markAgentApiRunFailed,
  recordApiRunEvent,
}));
mock.module("@/lib/agent-api-runs/snapshots", () => ({
  getAgentRunSnapshot,
}));
mock.module("@/lib/db/composio", () => ({
  isComposioProfileAllowedForRepository: async () => ({ allowed: true }),
}));
mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    autoCommitPush: true,
    autoCreatePr: true,
    composioAgentDefaults: { main: { defaultProfileId: null } },
    defaultInferenceProfileId: null,
    defaultManagedRuntimeProfileId: "web-bun-agent-browser",
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSandboxType: "vercel",
    globalSkillRefs: [],
  }),
}));
mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => rateLimitResponse,
  rateLimitKey: (parts: string[]) => parts.join(":"),
}));

const routeModulePromise = import("./route");

function createRequest(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/v1/agent-runs", {
    method: "POST",
    headers: {
      authorization: "Bearer oa_test",
      "content-type": "application/json",
      "idempotency-key": "idem-1",
      "x-request-id": "req-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("/api/v1/agent-runs", () => {
  beforeEach(() => {
    authResult = {
      ok: true,
      userId: "user-1",
      token: {
        id: "token-1",
        rateLimitMax: 60,
        rateLimitWindowMs: 60_000,
      },
      repositoryPolicy: { allowedRepositories: null },
    };
    createRunReplay = false;
    createRunCalls = [];
    createSessionCalls = [];
    workflowStartCalls = [];
    attachCalls = [];
    eventCalls = [];
    listCalls = [];
    failCalls = [];
    rateLimitResponse = null;
    verifyBearerApiToken.mockClear();
    createAgentApiRun.mockClear();
    createSessionChatAndMessageForApiRun.mockClear();
    attachAgentApiRunWorkflow.mockClear();
    recordApiRunEvent.mockClear();
    listAgentApiRunsForToken.mockClear();
    markAgentApiRunFailed.mockClear();
    start.mockClear();
    getAgentRunSnapshot.mockClear();
    process.env.AGENT_API_ENABLED = "true";
  });

  test("POST requires a create-scoped bearer token before creating resources", async () => {
    authResult = {
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "A valid bearer API token is required.",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ prompt: "Run tests" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("invalid_token");
    expect(createAgentApiRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("POST denies repository allowlist misses before session or workflow creation", async () => {
    authResult = {
      ok: true,
      userId: "user-1",
      token: {
        id: "token-1",
        rateLimitMax: 60,
        rateLimitWindowMs: 60_000,
      },
      repositoryPolicy: { allowedRepositories: ["acme/widgets"] },
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        prompt: "Run tests",
        repository: { owner: "acme", name: "other" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("repository_not_allowed");
    expect(createAgentApiRun).not.toHaveBeenCalled();
    expect(createSessionChatAndMessageForApiRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("POST creates a session, persists the user message, starts workflow once, and returns 202", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        prompt: "Run tests",
        title: "API test",
        repository: { owner: "acme", name: "widgets", newBranch: true },
        autoCommitPush: true,
        autoCreatePr: true,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.agentRun.id).toBe("arun_test");
    expect(createRunCalls).toHaveLength(1);
    expect(createRunCalls[0]).toMatchObject({
      id: "arun_test",
      idempotencyKeyHash: "hash:idem-1",
      requestId: "req-test",
      runtimeMode: "managed_runtime",
    });
    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]).toMatchObject({
      session: {
        userId: "user-1",
        repoOwner: "acme",
        repoName: "widgets",
        runtimeMode: "managed_runtime",
      },
      message: {
        role: "user",
      },
    });
    expect(workflowStartCalls).toHaveLength(1);
    expect(workflowStartCalls[0]?.[1]).toMatchObject([
      {
        userId: "user-1",
        requestId: "req-test",
        agentApiRunId: "arun_test",
      },
    ]);
    expect(attachCalls).toEqual([
      {
        runId: "arun_test",
        sessionId: expect.stringMatching(/^session_/),
        chatId: expect.stringMatching(/^chat_/),
        workflowRunId: "workflow_test",
      },
    ]);
    expect(eventCalls).toHaveLength(1);
  });

  test("POST idempotency replay returns the existing run without duplicate workflow work", async () => {
    createRunReplay = true;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ prompt: "Run tests" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.idempotentReplay).toBe(true);
    expect(createAgentApiRun).toHaveBeenCalledTimes(1);
    expect(createSessionChatAndMessageForApiRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("GET lists runs visible to the read-scoped token", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/v1/agent-runs?limit=5&status=running", {
        headers: { authorization: "Bearer oa_test" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agentRuns).toEqual([
      expect.objectContaining({ id: "arun_test" }),
    ]);
    expect(listCalls).toEqual([
      {
        userId: "user-1",
        tokenId: "token-1",
        limit: 5,
        status: "running",
      },
    ]);
  });
});
