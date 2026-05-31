import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

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
let pushShouldThrow: boolean;
let revokeInstallationTokenImpl: () => Promise<void>;

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
  revokeInstallationToken: async (...args: unknown[]) =>
    revokeInstallationTokenImpl(...(args as [])),
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
    if (pushShouldThrow) {
      throw new Error("git push: authentication failed");
    }
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
    pushShouldThrow = false;
    revokeInstallationTokenImpl = async () => undefined;
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

  // BT-001: Partial failure surfaces created repo identity
  test("BT-001: when push step throws after repo creation, response includes created repo owner/name/url and pushFailed status", async () => {
    pushShouldThrow = true;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    // Must NOT be a bare 500 that hides the orphan
    expect(response.status).not.toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    // Response must include the created repo identity so client can resume
    expect(body.owner).toBe("octocat");
    expect(body.repoName).toBe("repo-1");
    expect(body.repoUrl).toBe("https://github.com/octocat/repo-1");
    // Must signal that push/link is incomplete
    expect(body.status).toMatch(/pushFailed|linkPending/);
  });

  // BT-002: Fail closed when GitHub App installation token is unavailable
  test("BT-002: when GitHub App installation token is unavailable, does not broker broad user OAuth token into sandbox", async () => {
    // App access check fails, and mintInstallationToken would throw
    accessResult = { ok: false, reason: "app_no_access" };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    // Must fail closed with a remediation message; must NOT inject user token
    expect(response.status).toBe(403);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).toLowerCase()).toMatch(
      /app|install|grant|permission/,
    );
    // User token must NOT have been used in push
    expect(temporaryAuthTokens).not.toContain("user-token");
  });

  // BT-003: Revoke failure does not turn success into 500
  test("BT-003: when push succeeds but token revocation throws, response is success and revocation error is logged as warning", async () => {
    revokeInstallationTokenImpl = async () => {
      throw new Error("revocation network failure");
    };
    const warnSpy = spyOn(console, "warn");
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.repoUrl).toBe("https://github.com/octocat/repo-1");
    // Revocation failure must be downgraded to a warning
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // BT-004: clone_url validation rejects bad hostnames / embedded credentials
  test("BT-004: when clone_url has an unexpected host, rejects before running git remote add", async () => {
    globalThis.fetch = mock(
      async (_url: string | URL, _init?: RequestInit) => {
        const href = String(_url);
        if (href === "https://api.github.com/user/repos") {
          return new Response(
            JSON.stringify({
              id: 999,
              name: "evil-repo",
              full_name: "evil/evil-repo",
              html_url: "https://evil.com/evil/evil-repo",
              // Malicious clone_url with unexpected host
              clone_url: "https://evil.com/evil/evil-repo.git",
              owner: { login: "evil" },
            }),
            { status: 201 },
          );
        }
        return new Response("unexpected url", { status: 500 });
      },
    ) as unknown as typeof fetch;

    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(500);
    // git remote add must NOT have run with the malicious URL
    expect(execCommands).not.toContain(
      "git remote add origin https://evil.com/evil/evil-repo.git",
    );
  });

  test("BT-004b: when clone_url contains embedded credentials, rejects before running git remote add", async () => {
    globalThis.fetch = mock(
      async (_url: string | URL, _init?: RequestInit) => {
        const href = String(_url);
        if (href === "https://api.github.com/user/repos") {
          return new Response(
            JSON.stringify({
              id: 999,
              name: "myrepo",
              full_name: "octocat/myrepo",
              html_url: "https://github.com/octocat/myrepo",
              // clone_url with embedded credentials — should be rejected
              clone_url:
                "https://attacker:token@github.com/octocat/myrepo.git",
              owner: { login: "octocat" },
            }),
            { status: 201 },
          );
        }
        return new Response("unexpected url", { status: 500 });
      },
    ) as unknown as typeof fetch;

    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(500);
    const execCommandsStr = execCommands.join("\n");
    expect(execCommandsStr).not.toContain("attacker");
  });

  // Regression: 422 from GitHub during repo creation returns that status, not 500
  test("regression: GitHub 422 during repo creation returns 422 to caller", async () => {
    globalThis.fetch = mock(
      async (_url: string | URL, _init?: RequestInit) => {
        const href = String(_url);
        if (href === "https://api.github.com/user/repos") {
          return new Response(
            JSON.stringify({ message: "Repository creation failed." }),
            { status: 422 },
          );
        }
        return new Response("unexpected url", { status: 500 });
      },
    ) as unknown as typeof fetch;

    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        owner: "octocat",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });
});
