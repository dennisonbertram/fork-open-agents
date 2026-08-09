import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
    username?: string;
    name?: string | null;
    email?: string | null;
  };
} | null;

type SessionRecord = {
  id: string;
  userId: string;
  cloneUrl: string | null;
  sandboxState: unknown;
} | null;

let authSession: AuthSession;
let sessionRecord: SessionRecord;
let sandboxActive = true;
let updateSessionCalls: { id: string; data: Record<string, unknown> }[] = [];
let workflowResult: unknown;
let workflowCalls: Record<string, unknown>[] = [];
let octokitInstance: unknown = { rest: {} };
let githubProfile: { username: string; externalUserId: string } | null = {
  username: "octocat",
  externalUserId: "1234",
};
let rateLimitedResponse: Response | null = null;
const sandboxHandle = { workingDirectory: "/work", exec: mock(async () => ({})) };

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async (_id: string) => sessionRecord,
  updateSession: async (id: string, data: Record<string, unknown>) => {
    updateSessionCalls.push({ id, data });
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: (_state: unknown) => sandboxActive,
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => rateLimitedResponse,
  rateLimitKey: (parts: string[]) => parts.join(":"),
}));

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async (_userId: string) => octokitInstance,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async (_userId: string) => githubProfile,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (_state: unknown) => sandboxHandle,
}));

mock.module("./_lib/create-repo-workflow", () => ({
  runCreateRepoWorkflow: async (params: Record<string, unknown>) => {
    workflowCalls.push(params);
    return workflowResult;
  },
}));

const routeModulePromise = import("./route");

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/github/create-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    repoName: "repo-1",
    sessionTitle: "My Session",
    owner: "octocat",
    ...overrides,
  };
}

function okWorkflowResult() {
  return {
    ok: true as const,
    repoUrl: "https://github.com/octocat/repo-1",
    cloneUrl: "https://github.com/octocat/repo-1.git",
    owner: "octocat",
    repoName: "repo-1",
    branch: "main" as const,
  };
}

describe("/api/github/create-repo", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1", username: "octocat" } };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      cloneUrl: null,
      sandboxState: { type: "vercel" },
    };
    sandboxActive = true;
    updateSessionCalls = [];
    workflowCalls = [];
    workflowResult = okWorkflowResult();
    octokitInstance = { rest: {} };
    githubProfile = { username: "octocat", externalUserId: "1234" };
    rateLimitedResponse = null;
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Not authenticated",
      errorKind: "unauthorized",
    });
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/github/create-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON body",
      errorKind: "invalid_request",
    });
  });

  test("returns 400 when sessionId is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ repoName: "repo-1", sessionTitle: "t" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errorKind).toBe("invalid_request");
  });

  test("returns 400 when repoName is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({ sessionId: "session-1", sessionTitle: "t" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errorKind).toBe("invalid_request");
  });

  test("returns 404 when the session does not exist", async () => {
    sessionRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(404);
    expect((await response.json()).errorKind).toBe("not_found");
  });

  test("returns 403 when the session belongs to another user", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "someone-else",
      cloneUrl: null,
      sandboxState: { type: "vercel" },
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(403);
    expect((await response.json()).errorKind).toBe("forbidden");
  });

  test("returns 400 when the session already has a repository", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      cloneUrl: "https://github.com/octocat/existing",
      sandboxState: { type: "vercel" },
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(400);
    expect((await response.json()).errorKind).toBe("invalid_request");
    expect(workflowCalls.length).toBe(0);
  });

  test("returns 400 when the sandbox is not active", async () => {
    sandboxActive = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(400);
    expect((await response.json()).errorKind).toBe("sandbox_unavailable");
    expect(workflowCalls.length).toBe(0);
  });

  test("returns 429 when rate limited", async () => {
    rateLimitedResponse = Response.json(
      { error: "Too many requests", errorKind: "rate_limited" },
      { status: 429 },
    );
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(429);
    expect(workflowCalls.length).toBe(0);
  });

  test("returns 401 with reconnect signal when GitHub token is unavailable", async () => {
    octokitInstance = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(401);
    expect((await response.json()).errorKind).toBe("github_not_connected");
    expect(workflowCalls.length).toBe(0);
  });

  test("propagates typed workflow failures", async () => {
    workflowResult = {
      ok: false,
      response: Response.json(
        { error: "Repository name is already taken", errorKind: "repo_name_taken" },
        { status: 409 },
      ),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(409);
    expect((await response.json()).errorKind).toBe("repo_name_taken");
  });

  test("creates the repo, updates the session, and returns repo details", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      repoUrl: "https://github.com/octocat/repo-1",
      cloneUrl: "https://github.com/octocat/repo-1.git",
      owner: "octocat",
      repoName: "repo-1",
      branch: "main",
    });

    expect(workflowCalls.length).toBe(1);
    const call = workflowCalls[0] as Record<string, unknown>;
    expect(call.repoName).toBe("repo-1");
    expect(call.owner).toBe("octocat");
    expect(call.accountType).toBe("User");
    expect(call.octokit).toBe(octokitInstance);

    expect(updateSessionCalls.length).toBe(1);
    expect(updateSessionCalls[0]?.id).toBe("session-1");
    expect(updateSessionCalls[0]?.data).toEqual({
      repoOwner: "octocat",
      repoName: "repo-1",
      cloneUrl: "https://github.com/octocat/repo-1",
      branch: "main",
      isNewBranch: false,
    });
  });

  test("treats a non-matching owner as an organization", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest(validBody({ owner: "my-org" })));

    expect(response.status).toBe(200);
    expect(workflowCalls[0]?.accountType).toBe("Organization");
  });
});
