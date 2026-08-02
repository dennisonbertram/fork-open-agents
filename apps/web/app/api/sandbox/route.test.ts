import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";

mock.module("server-only", () => ({}));

const scheduledAfterCallbacks: Promise<void>[] = [];

async function flushScheduledAfterCallbacks() {
  const callbacks = scheduledAfterCallbacks.splice(0);
  await Promise.allSettled(callbacks);
}

mock.module("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    scheduledAfterCallbacks.push(callback());
  },
}));

mock.module("botid/server", () => ({
  checkBotId: async () => ({ isBot: false }),
}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel"; sandboxName?: string; expiresAt?: number };
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
  globalSkillRefs: Array<{ source: string; skillName: string }>;
}

interface TestVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

interface KickCall {
  sessionId: string;
  reason: string;
}

interface ConnectConfig {
  state: {
    type: "vercel";
    sandboxName?: string;
    source?: {
      repo?: string;
      branch?: string;
      newBranch?: string;
    };
  };
  options?: {
    githubToken?: string;
    gitUser?: {
      email?: string;
    };
    persistent?: boolean;
    resume?: boolean;
    createIfMissing?: boolean;
    timeout?: number;
    vcpus?: number;
  };
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: ConnectConfig[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];
const dotenvSyncCalls: Array<Record<string, unknown>> = [];
const globalSkillInstallCalls: Array<{
  refs: Array<{ source: string; skillName: string }>;
}> = [];

let sessionRecord: TestSessionRecord;
let currentVercelAuthInfo: TestVercelAuthInfo | null;
let currentDotenvContent: string;
let currentDotenvError: Error | null;
let blockGlobalSkillInstall: Promise<void> | null;
let unblockGlobalSkillInstall: (() => void) | null;
let blockTokenRevoke: Promise<void> | null;
let unblockTokenRevoke: (() => void) | null;

function createDeferred() {
  let resolveDeferred: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: {
      id: "user-1",
      username: "nico",
      name: "Nico",
      email: "nico@example.com",
    },
  }),
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async () => ({
    externalUserId: "12345",
    username: "nico-gh",
  }),
}));

mock.module("@/lib/github/urls", () => ({
  parseGitHubHttpsUrl: (repoUrl: string) => {
    let parsed: URL;
    try {
      parsed = new URL(repoUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
    if (!match?.[1] || !match[2]) {
      return null;
    }
    return { owner: match[1], repo: match[2] };
  },
}));

type RepoAccessMock =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | { ok: false; reason: string };

let repoAccessResult: RepoAccessMock = {
  ok: true,
  installationId: 999,
  repositoryId: 123,
  defaultBranch: "main",
};

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => repoAccessResult,
  getRepoAccessErrorMessage: (reason: string) => `Access denied: ${reason}`,
  getRepoAccessErrorStatus: (reason: string) => {
    if (reason === "user_token_rejected" || reason === "no_user_token") {
      return 401;
    }
    if (reason === "rate_limited") return 429;
    return 403;
  },
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: async () => ({
    token: "installation-token-mock",
    expiresAt: null,
    installationId: 999,
    repositoryIds: [123],
    permissions: { contents: "read" },
  }),
  revokeInstallationToken: async () => {
    if (blockTokenRevoke) {
      await blockTokenRevoke;
    }
  },
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelAuthInfo: async () => currentVercelAuthInfo,
  getUserVercelToken: async () => currentVercelAuthInfo?.token ?? null,
}));

mock.module("@/lib/vercel/projects", () => ({
  buildDevelopmentDotenvFromVercelProject: async (
    input: Record<string, unknown>,
  ) => {
    dotenvSyncCalls.push(input);
    if (currentDotenvError) {
      throw currentDotenvError;
    }
    return currentDotenvContent;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    return {
      ...sessionRecord,
      ...patch,
    };
  },
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: async (params: {
    sandbox: {
      workingDirectory: string;
      exec: (
        command: string,
        cwd: string,
        timeoutMs: number,
      ) => Promise<unknown>;
    };
    globalSkillRefs: Array<{ source: string; skillName: string }>;
  }) => {
    globalSkillInstallCalls.push({ refs: params.globalSkillRefs });
    if (blockGlobalSkillInstall) {
      await blockGlobalSkillInstall;
    }

    const homeResult = await params.sandbox.exec(
      'printf %s "$HOME"',
      params.sandbox.workingDirectory,
      5000,
    );
    const home =
      typeof homeResult === "object" &&
      homeResult !== null &&
      "stdout" in homeResult &&
      typeof homeResult.stdout === "string"
        ? homeResult.stdout
        : "/root";

    for (const ref of params.globalSkillRefs) {
      await params.sandbox.exec(
        `HOME='${home}' npx skills add '${ref.source}' --skill '${ref.skillName}' --agent amp -g -y --copy`,
        params.sandbox.workingDirectory,
        120000,
      );
    }
  },
}));

mock.module("@/lib/skills/session-user-skills", () => ({
  installSessionUserSkills: async () => undefined,
}));

const sandboxWorkspace: { origin: string | null; branch: string } = {
  origin: "https://github.com/acme/private-repo\n",
  branch: "main\n",
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (config: ConnectConfig) => {
    connectConfigs.push(config);

    return {
      currentBranch: "main",
      workingDirectory: "/vercel/sandbox",
      getState: () => ({
        type: "vercel" as const,
        sandboxName: config.state.sandboxName ?? "session_session-1",
        expiresAt: Date.now() + 120_000,
      }),
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        execCalls.push({ command, cwd, timeoutMs });
        if (command === 'printf %s "$HOME"') {
          return {
            success: true,
            exitCode: 0,
            stdout: "/root",
            stderr: "",
            truncated: false,
          };
        }

        if (command === "git remote get-url origin") {
          return {
            success: sandboxWorkspace.origin !== null,
            exitCode: sandboxWorkspace.origin === null ? 1 : 0,
            stdout: sandboxWorkspace.origin ?? "",
            stderr: "",
            truncated: false,
          };
        }

        if (command === "git rev-parse --abbrev-ref HEAD") {
          return {
            success: true,
            exitCode: 0,
            stdout: sandboxWorkspace.branch,
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
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path, content });
      },
      stop: async () => {},
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox lifecycle kicks", () => {
  beforeEach(async () => {
    unblockGlobalSkillInstall?.();
    unblockTokenRevoke?.();
    await flushScheduledAfterCallbacks();

    kickCalls.length = 0;
    updateCalls.length = 0;
    connectConfigs.length = 0;
    writeFileCalls.length = 0;
    execCalls.length = 0;
    dotenvSyncCalls.length = 0;
    globalSkillInstallCalls.length = 0;
    blockGlobalSkillInstall = null;
    unblockGlobalSkillInstall = null;
    blockTokenRevoke = null;
    unblockTokenRevoke = null;
    currentVercelAuthInfo = {
      token: "vercel-token",
      expiresAt: 1_700_000_000,
      externalId: "user_ext_1",
    };
    sandboxWorkspace.origin = "https://github.com/acme/private-repo\n";
    sandboxWorkspace.branch = "main\n";
    currentDotenvContent = 'API_KEY="secret"\n';
    currentDotenvError = null;
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      vercelProjectId: "project-1",
      vercelProjectName: "open-agents-web",
      vercelTeamId: "team-1",
      globalSkillRefs: [],
    };
  });

  test("uses session_<sessionId> as the persistent sandbox name", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvContent = "";
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      options: {
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
    expect(dotenvSyncCalls).toHaveLength(0);
  });

  function postSandbox(body: Record<string, unknown>) {
    return new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxType: "vercel", ...body }),
    });
  }

  test("reuses an already-active sandbox but reports the branch it actually has checked out", async () => {
    const { POST } = await routeModulePromise;
    const expiresAt = Date.now() + 120_000;

    sessionRecord.sandboxState = {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt,
    };
    sandboxWorkspace.branch = "mr/ad358c87\n";

    const response = await POST(
      postSandbox({
        sessionId: "session-1",
        repoUrl: "https://github.com/acme/private-repo",
        branch: "develop",
      }),
    );

    const payload = (await response.json()) as {
      mode: string;
      timeout: number;
      currentBranch?: string;
      timing: { readyMs: number };
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("vercel");
    expect(payload.currentBranch).toBe("mr/ad358c87");
    expect(payload.timeout).toBeGreaterThan(0);
    expect(payload.timeout).toBeLessThanOrEqual(120_000);
    expect(updateCalls).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
    expect(globalSkillInstallCalls).toHaveLength(0);
  });

  test("fails with a typed error when the already-active sandbox never cloned the repo", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.sandboxState = {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: Date.now() + 120_000,
    };
    sandboxWorkspace.origin = null;
    sandboxWorkspace.branch = "master\n";

    const response = await POST(
      postSandbox({
        sessionId: "session-1",
        repoUrl: "https://github.com/acme/private-repo",
        branch: "develop",
      }),
    );

    const payload = (await response.json()) as {
      error: string;
      reason?: string;
      currentBranch?: string;
    };

    expect(response.status).toBe(409);
    expect(payload.reason).toBe("workspace_not_cloned");
    expect(payload.currentBranch).toBeUndefined();
  });

  test("fails with a typed error when a freshly created sandbox has no clone", async () => {
    const { POST } = await routeModulePromise;

    sandboxWorkspace.origin = null;

    const response = await POST(
      postSandbox({
        sessionId: "session-1",
        repoUrl: "https://github.com/acme/private-repo",
        branch: "main",
      }),
    );

    const payload = (await response.json()) as {
      error: string;
      reason?: string;
    };

    expect(response.status).toBe(409);
    expect(payload.reason).toBe("workspace_not_cloned");
  });

  test("reports the sandbox branch, not the requested branch, after creation", async () => {
    const { POST } = await routeModulePromise;

    sandboxWorkspace.branch = "mr/ad358c87\n";

    const response = await POST(
      postSandbox({
        sessionId: "session-1",
        repoUrl: "https://github.com/acme/private-repo",
        branch: "develop",
        isNewBranch: true,
      }),
    );

    const payload = (await response.json()) as { currentBranch?: string };

    expect(response.status).toBe(200);
    expect(payload.currentBranch).toBe("mr/ad358c87");
  });

  test("repo sandboxes use a setup-only installation token instead of embedding it", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          repoUrl: "https://github.com/acme/private-repo",
          branch: "main",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
        source: {
          repo: "https://github.com/acme/private-repo",
          branch: "main",
        },
      },
      options: {
        githubToken: "installation-token-mock",
      },
    });
    expect(connectConfigs[0]?.state.source).not.toHaveProperty("token");
  });

  test("repo sandbox creation responds before skill install and token revoke finish", async () => {
    const { POST } = await routeModulePromise;
    const globalSkillDeferred = createDeferred();
    const tokenRevokeDeferred = createDeferred();

    blockGlobalSkillInstall = globalSkillDeferred.promise;
    unblockGlobalSkillInstall = globalSkillDeferred.resolve;
    blockTokenRevoke = tokenRevokeDeferred.promise;
    unblockTokenRevoke = tokenRevokeDeferred.resolve;
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;
    sessionRecord.globalSkillRefs = [
      { source: "vercel/ai", skillName: "ai-sdk" },
    ];

    const postPromise = POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          repoUrl: "https://github.com/acme/private-repo",
          branch: "main",
          sandboxType: "vercel",
        }),
      }),
    );

    try {
      const response = await Promise.race([
        postPromise,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 1000);
        }),
      ]);

      expect(response).not.toBeNull();
      expect(response?.ok).toBe(true);
      expect(globalSkillInstallCalls).toEqual([
        { refs: [{ source: "vercel/ai", skillName: "ai-sdk" }] },
      ]);
    } finally {
      unblockGlobalSkillInstall?.();
      unblockTokenRevoke?.();
      await flushScheduledAfterCallbacks();
    }
  });

  test("rejects repo URLs that only contain github.com in the path", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          repoUrl: "https://attacker.example/github.com/acme/private-repo",
          branch: "main",
          sandboxType: "vercel",
        }),
      }),
    );

    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid GitHub repository URL");
    expect(connectConfigs).toHaveLength(0);
  });

  test("new vercel sandbox does not sync linked Development env vars while code is commented out", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(connectConfigs[0]?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([]);

    const payload = (await response.json()) as {
      timeout: number;
      mode: string;
    };
    expect(payload.timeout).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(payload.mode).toBe("vercel");
  });

  test("commented-out env sync does not run during sandbox creation", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvError = new Error("boom");

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([]);
  });

  test("new sandboxes install global skills", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.globalSkillRefs = [
      { source: "vercel/ai", skillName: "ai-sdk" },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(execCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'printf %s "$HOME"' }),
        expect.objectContaining({
          command:
            "HOME='/root' npx skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        }),
      ]),
    );
  });

  test("rejects unsupported sandbox types", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "invalid",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid sandbox type");
    expect(connectConfigs).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
  });
});

// Regression for issue #1056: a rejected stored GitHub credential surfaced as
// an uncaught Octokit HttpError → 500. It must be a typed 4xx instead.
describe("/api/sandbox repo access denials", () => {
  function repoRequest() {
    return new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        repoUrl: "https://github.com/vercel-labs/open-agents",
        branch: "main",
      }),
    });
  }

  test("rejected GitHub credential answers 401, not 500", async () => {
    const { POST } = await routeModulePromise;
    repoAccessResult = { ok: false, reason: "user_token_rejected" };

    const response = await POST(repoRequest());
    const payload = (await response.json()) as {
      error: string;
      reason: string;
    };

    expect(response.status).toBe(401);
    expect(payload.reason).toBe("user_token_rejected");
    expect(connectConfigs).toHaveLength(0);
  });

  test("rate-limited GitHub answers 429, not a reconnect prompt", async () => {
    const { POST } = await routeModulePromise;
    repoAccessResult = { ok: false, reason: "rate_limited" };

    const response = await POST(repoRequest());
    const payload = (await response.json()) as { reason: string };

    expect(response.status).toBe(429);
    expect(payload.reason).toBe("rate_limited");
  });

  test("permission denial keeps its 403", async () => {
    const { POST } = await routeModulePromise;
    repoAccessResult = { ok: false, reason: "app_no_access" };

    const response = await POST(repoRequest());

    expect(response.status).toBe(403);

    repoAccessResult = {
      ok: true,
      installationId: 999,
      repositoryId: 123,
      defaultBranch: "main",
    };
  });
});
