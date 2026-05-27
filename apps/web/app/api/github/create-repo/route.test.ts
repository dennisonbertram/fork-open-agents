import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
  };
} | null;

type OwnedSessionResult =
  | {
      ok: true;
      sessionRecord: {
        id: string;
        userId: string;
        repoOwner: string | null;
        repoName: string | null;
        sandboxState: {
          type: "vercel";
          sandboxName: string;
          expiresAt: number;
        } | null;
      };
    }
  | {
      ok: false;
      response: Response;
    };

type Installation = {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
};

let authSession: AuthSession;
let botBlocked: boolean;
let rateLimitResponse: Response | null;
let ownedSessionResult: OwnedSessionResult;
let installation: Installation | undefined;
let userToken: string | null;
let accessResult:
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | { ok: false; reason: "app_no_access" };
let mintedToken: { token: string };
let updatedSession:
  | {
      sessionId: string;
      data: Record<string, unknown>;
    }
  | undefined;
let execCommands: string[];
let temporaryAuthTokens: Array<string | undefined>;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/botid", () => ({
  checkBotProtection: async () => ({ isBot: botBlocked }),
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => rateLimitResponse,
  rateLimitKey: (parts: string[]) => parts.join(":"),
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireOwnedSession: async () => ownedSessionResult,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationByAccountLogin: async () => installation,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => userToken,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => accessResult,
  getRepoAccessErrorMessage: (reason: string) => `access error: ${reason}`,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: async () => mintedToken,
  revokeInstallationToken: async () => undefined,
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async (sessionId: string, data: Record<string, unknown>) => {
    updatedSession = { sessionId, data };
    return { id: sessionId, ...data };
  },
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/repo",
    exec: async (command: string) => {
      execCommands.push(command);
      if (command === "git diff --cached --quiet") {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      };
    },
  }),
  withTemporaryGitHubAuth: async <T>(
    _sandbox: unknown,
    token: string | undefined,
    operation: () => Promise<T>,
  ) => {
    temporaryAuthTokens.push(token);
    return operation();
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

function mockGitHubCreateRepoFetch() {
  globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href === "https://api.github.com/user/repos") {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          id: 123,
          name: "repo-1",
          full_name: "octocat/repo-1",
          html_url: "https://github.com/octocat/repo-1",
          clone_url: "https://github.com/octocat/repo-1.git",
          owner: { login: "octocat" },
        }),
        { status: 201 },
      );
    }

    if (
      href === "https://api.github.com/user/installations/42/repositories/123"
    ) {
      return new Response(null, { status: 204 });
    }

    return new Response("unexpected url", { status: 500 });
  }) as unknown as typeof fetch;
}

describe("/api/github/create-repo", () => {
  beforeEach(() => {
    authSession = {
      user: {
        id: "user-1",
      },
    };
    botBlocked = false;
    rateLimitResponse = null;
    ownedSessionResult = {
      ok: true,
      sessionRecord: {
        id: "session-1",
        userId: "user-1",
        repoOwner: null,
        repoName: null,
        sandboxState: {
          type: "vercel",
          sandboxName: "session-1",
          expiresAt: Date.now() + 600_000,
        },
      },
    };
    installation = {
      installationId: 42,
      accountLogin: "octocat",
      accountType: "User",
      repositorySelection: "all",
    };
    userToken = "user-token";
    accessResult = {
      ok: true,
      installationId: 42,
      repositoryId: 123,
      defaultBranch: "main",
    };
    mintedToken = { token: "installation-token" };
    updatedSession = undefined;
    execCommands = [];
    temporaryAuthTokens = [];
    mockGitHubCreateRepoFetch();
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ sessionId: "session-1" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
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
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  });

  test("creates a GitHub repository, pushes the sandbox, and links the session", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
        description: "A scratch project",
        isPrivate: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repoUrl: "https://github.com/octocat/repo-1",
      owner: "octocat",
      repoName: "repo-1",
      cloneUrl: "https://github.com/octocat/repo-1.git",
      branch: "main",
      appAccess: "verified",
    });
    expect(execCommands).toEqual([
      "git status --short",
      "git branch -M main",
      "git add -A",
      "git diff --cached --quiet",
      'git commit -m "Initial commit"',
      "git remote remove origin",
      "git remote add origin https://github.com/octocat/repo-1.git",
      "GIT_TERMINAL_PROMPT=0 git push -u origin main",
    ]);
    expect(temporaryAuthTokens).toEqual(["installation-token"]);
    expect(updatedSession).toEqual({
      sessionId: "session-1",
      data: {
        repoOwner: "octocat",
        repoName: "repo-1",
        cloneUrl: "https://github.com/octocat/repo-1.git",
        branch: "main",
        isNewBranch: false,
      },
    });
  });

  test("adds newly created repositories to selected app installations", async () => {
    installation = {
      installationId: 42,
      accountLogin: "octocat",
      accountType: "User",
      repositorySelection: "selected",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test("falls back to the user token when app access is not available yet", async () => {
    accessResult = { ok: false, reason: "app_no_access" };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      appAccess: "needs_update",
      appAccessMessage: "access error: app_no_access",
    });
    expect(temporaryAuthTokens).toEqual(["user-token"]);
  });

  test("requires a GitHub token with repository permissions", async () => {
    userToken = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Reconnect GitHub before creating a repository.",
    });
  });
});
