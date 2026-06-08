/**
 * Unit tests for resolveChatSandboxRuntime.
 *
 * BT-001: session.sandboxState === null → returns sandbox-free runtime, connectSandbox NOT called.
 * BT-002: session.sandboxState non-null (active) → resumes sandbox, connectSandbox IS called.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox, SandboxState } from "@open-agents/sandbox";

// ── Spy/mock state ────────────────────────────────────────────────────────────

type FakeSandbox = Pick<
  Sandbox,
  "workingDirectory" | "currentBranch" | "environmentDetails"
> & {
  getState?: () => SandboxState;
  exec: Sandbox["exec"];
};

const ACTIVE_SANDBOX_STATE: SandboxState = {
  type: "vercel",
  sandboxName: "session_existing-session",
  sandboxId: "sbx_existing",
  expiresAt: Date.now() + 60_000,
  status: "running",
};

const fakeSandbox: FakeSandbox = {
  workingDirectory: "/vercel/sandbox",
  currentBranch: "main",
  environmentDetails: "test env",
  getState: () => ACTIVE_SANDBOX_STATE,
  exec: async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" }),
};

const connectSandboxSpy = mock(async () => fakeSandbox as unknown as Sandbox);

// Module mocks — must be declared before the module under test is imported.

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxSpy,
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  getManagedRuntimeProfile: () => ({
    id: "test-profile",
    version: "1.0",
    displayName: "Test Profile",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
  }),
}));

mock.module("workflow", () => ({
  getWritable: () =>
    new WritableStream({ write() {} }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async (id: string) => testSessionById[id] ?? null,
  updateSession: async () => undefined,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => ({
    ok: true,
    installationId: 1,
    repositoryId: 1,
  }),
  getRepoAccessErrorMessage: () => "repo access error",
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: async () => ({
    token: "fake-token",
    tokenId: "tok_1",
    expiresAt: new Date(),
  }),
  revokeInstallationToken: async () => undefined,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async () => null,
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async () => null,
}));

mock.module("@/lib/managed-runtime/profile-resolution", () => ({
  resolveManagedRuntimeProfile: async () => ({
    id: "test-profile",
    version: "1.0",
    displayName: "Test Profile",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
  }),
}));

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  appendManagedRuntimeSetupResult: async () => undefined,
  appendManagedRuntimeVerificationResult: async () => undefined,
  buildManagedRuntimeCommandObservation: () => ({}),
  finishManagedRuntimeProfileRun: async () => undefined,
  startManagedRuntimeProfileRun: async () => ({ id: "run_1" }),
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
  getNextLifecycleVersion: () => 1,
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: () => undefined,
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: null,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

mock.module("@/lib/sandbox/utils", () => ({
  getResumableSandboxName: (state: unknown) => {
    if (
      typeof state === "object" &&
      state !== null &&
      "sandboxName" in state &&
      typeof (state as Record<string, unknown>).sandboxName === "string"
    ) {
      return (state as Record<string, unknown>).sandboxName as string;
    }
    return null;
  },
  getSessionSandboxName: (id: string) => `session_${id}`,
  isSandboxActive: (state: unknown) => {
    return (
      typeof state === "object" &&
      state !== null &&
      "status" in state &&
      (state as Record<string, unknown>).status === "running"
    );
  },
}));

mock.module("@/lib/skills/directories", () => ({
  getSandboxSkillDirectories: async () => [],
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: async () => undefined,
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => null,
  setCachedSkills: async () => undefined,
}));

mock.module("@open-agents/agent", () => ({
  discoverSkills: async () => [],
}));

mock.module("./workspace-startup-log", () => ({
  WorkspaceStartupReporter: class {
    constructor() {}
    async send() {}
    async appendCommandResult() {}
  },
}));

// ── Test session records ───────────────────────────────────────────────────────

type TestSession = {
  id: string;
  userId: string;
  sandboxState: SandboxState | null;
  status: string;
  runtimeMode: "classic" | "managed_runtime";
  repoOwner: string | null;
  repoName: string | null;
  cloneUrl: string | null;
  branch: string | null;
  isNewBranch: boolean | null;
  prNumber: number | null;
  title: string;
  lifecycleVersion: number | null;
  globalSkillRefs: string[] | null;
  managedRuntimeProfileId: string | null;
  inferenceProfileId: string | null;
  autoCommitPushOverride: boolean | null;
  autoCreatePrOverride: boolean | null;
};

const testSessionById: Record<string, TestSession> = {};

function makeSandboxFreeSession(
  overrides: Partial<TestSession> = {},
): TestSession {
  return {
    id: "session-sandbox-free",
    userId: "user-1",
    sandboxState: null,
    status: "active",
    runtimeMode: "classic",
    repoOwner: null,
    repoName: null,
    cloneUrl: null,
    branch: null,
    isNewBranch: null,
    prNumber: null,
    title: "New Chat",
    lifecycleVersion: null,
    globalSkillRefs: [],
    managedRuntimeProfileId: null,
    inferenceProfileId: null,
    autoCommitPushOverride: null,
    autoCreatePrOverride: null,
    ...overrides,
  };
}

function makeRepoSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    id: "session-with-repo",
    userId: "user-1",
    sandboxState: ACTIVE_SANDBOX_STATE,
    status: "active",
    runtimeMode: "classic",
    repoOwner: "acme",
    repoName: "my-repo",
    cloneUrl: "https://github.com/acme/my-repo.git",
    branch: "main",
    isNewBranch: null,
    prNumber: null,
    title: "Repo Chat",
    lifecycleVersion: null,
    globalSkillRefs: [],
    managedRuntimeProfileId: null,
    inferenceProfileId: null,
    autoCommitPushOverride: null,
    autoCreatePrOverride: null,
    ...overrides,
  };
}

// ── Import the module under test (after all mocks are declared) ────────────────

const { resolveChatSandboxRuntime } = await import("./chat-sandbox-runtime");

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  connectSandboxSpy.mockClear();
  for (const key of Object.keys(testSessionById)) {
    delete testSessionById[key];
  }
});

describe("resolveChatSandboxRuntime", () => {
  describe("BT-001: sandbox-free session (sandboxState === null)", () => {
    test("returns mode: sandbox-free without calling connectSandbox", async () => {
      const session = makeSandboxFreeSession();
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-1",
      });

      // connectSandbox must NOT have been called
      expect(connectSandboxSpy).not.toHaveBeenCalled();

      // Must indicate sandbox-free mode
      expect(result.mode).toBe("sandbox-free");

      // sandboxState must be null (no VM was created)
      expect(result.sandboxState).toBeNull();
    });

    test("returns expected fields for sandbox-free runtime", async () => {
      const session = makeSandboxFreeSession({ title: "My Chat" });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-2",
      });

      expect(result.mode).toBe("sandbox-free");
      expect(result.sandboxState).toBeNull();
      expect(result.sessionTitle).toBe("My Chat");
      expect(result.runtimeMode).toBe("classic");
      expect(Array.isArray(result.skills)).toBe(true);
    });

    test("does not call connectSandbox even when session has a title and userId", async () => {
      const session = makeSandboxFreeSession({
        id: "session-abc",
        title: "Chat about code",
      });
      testSessionById[session.id] = session;

      await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-3",
      });

      expect(connectSandboxSpy).toHaveBeenCalledTimes(0);
    });

    test("throws when session not found", async () => {
      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: "nonexistent",
          assistantId: "asst-4",
        }),
      ).rejects.toThrow("Session not found");

      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });

    test("throws when session belongs to different user", async () => {
      const session = makeSandboxFreeSession({ id: "session-other" });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "different-user",
          sessionId: session.id,
          assistantId: "asst-5",
        }),
      ).rejects.toThrow("Unauthorized");

      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("BT-002: session with sandboxState non-null → connectSandbox IS called", () => {
    test("calls connectSandbox when session has active sandboxState", async () => {
      const session = makeRepoSession();
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-6",
      });

      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);
      expect(result.mode).toBe("sandbox");
      expect(result.sandboxState).not.toBeNull();
    });

    test("returns sandboxState from sandbox after connect", async () => {
      const session = makeRepoSession();
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-7",
      });

      expect(result.mode).toBe("sandbox");
      // sandboxState must be non-null and have a sandboxName
      expect(result.sandboxState).not.toBeNull();
      if (result.mode === "sandbox") {
        expect(result.sandboxState.type).toBe("vercel");
        expect(typeof result.sandboxState.sandboxName).toBe("string");
      }
    });
  });
});
