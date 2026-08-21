/**
 * Unit tests for prewarmSessionSandbox.
 *
 * BT-001: session not found → returns { status: "skipped", reason: "session-not-found" }; connectSandbox NOT called.
 * BT-002: session.userId !== userId → returns { status: "skipped", reason: "unauthorized" }; connectSandbox NOT called.
 * BT-003: session.status === "archived" → returns { status: "skipped", reason: "archived" }; connectSandbox NOT called.
 * BT-004: session.sandboxState is null (sandbox-free) → returns { status: "skipped", reason: "sandbox-free" }; connectSandbox NOT called.
 * BT-005: isSandboxActive true → returns { status: "skipped", reason: "already-active" }; connectSandbox NOT called.
 * BT-006: eligible session → calls connectSandbox, persists active state via updateSession, installs global+user skills with didSetupWorkspace:true, kicks lifecycle, returns { status: "prewarmed" }.
 * BT-007: session.fullClone === true → connectSandbox options include cloneDepth: 0.
 * BT-008: session.fullClone === false (default) → connectSandbox options omit cloneDepth.
 * BT-009: repo access failure → { status: "failed" }; connectSandbox NOT called; token still handled.
 * BT-010: mints token with contents: "read" and revokes it in finally.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox, SandboxState } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

// ── Spy state ─────────────────────────────────────────────────────────────────

const ACTIVE_SANDBOX_STATE: SandboxState = {
  type: "vercel",
  sandboxName: "session_test-session",
  sandboxId: "sbx_active",
  expiresAt: Date.now() + 60_000,
};

const INACTIVE_SANDBOX_STATE: SandboxState = {
  type: "vercel",
  sandboxName: "session_test-session",
};

type FakeSandbox = Pick<
  Sandbox,
  "workingDirectory" | "currentBranch" | "environmentDetails"
> & {
  getState?: () => SandboxState;
  exec: Sandbox["exec"];
  wasCreated?: boolean;
};

const fakeSandbox: FakeSandbox = {
  workingDirectory: "/vercel/sandbox",
  currentBranch: "main",
  environmentDetails: "test env",
  getState: () => ACTIVE_SANDBOX_STATE,
  exec: async () => ({
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    truncated: false,
  }),
};

// ── Spies ─────────────────────────────────────────────────────────────────────

const spies = {
  getSessionById: mock(
    async () => null as ReturnType<typeof makeTestSession> | null,
  ),
  updateSession: mock(async () => undefined),
  connectSandbox: mock(async () => fakeSandbox as unknown as Sandbox),
  isSandboxActive: mock((_state: unknown) => false),
  verifyRepoAccess: mock(
    async () =>
      ({
        ok: true as const,
        installationId: 42,
        repositoryId: 99,
      }) as
        | { ok: true; installationId: number; repositoryId: number }
        | { ok: false; reason: string },
  ),
  getRepoAccessErrorMessage: mock((_reason: unknown) => "repo access error"),
  mintInstallationToken: mock(async () => ({
    token: "fake-token",
    tokenId: "tok_1",
    expiresAt: new Date(),
  })),
  revokeInstallationToken: mock(async () => undefined),
  getGitUser: mock(async (_userId: string) => ({
    name: "Test User",
    email: "test@example.com",
  })),
  getGitHubUserProfile: mock(async () => null as null),
  installGlobalSkills: mock(async (_params: unknown) => undefined),
  installSessionUserSkills: mock(async () => undefined),
  kickSandboxLifecycleWorkflow: mock(() => undefined),
  buildActiveLifecycleUpdate: mock((_state: unknown) => ({
    lifecycleState: "active",
  })),
  getNextLifecycleVersion: mock((_v: unknown) => 1),
  getResumableSandboxName: mock((_state: unknown) => "session_test-session"),
  getSessionSandboxName: mock((id: string) => `session_${id}`),
  claimSessionPrewarmRunId: mock(async () => true),
  clearSessionPrewarmRunId: mock(async () => undefined),
};

// ── Module mocks ──────────────────────────────────────────────────────────────

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
  claimSessionPrewarmRunId: spies.claimSessionPrewarmRunId,
  clearSessionPrewarmRunId: spies.clearSessionPrewarmRunId,
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: spies.isSandboxActive,
  getResumableSandboxName: spies.getResumableSandboxName,
  getSessionSandboxName: spies.getSessionSandboxName,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: spies.verifyRepoAccess,
  getRepoAccessErrorMessage: spies.getRepoAccessErrorMessage,
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: spies.mintInstallationToken,
  revokeInstallationToken: spies.revokeInstallationToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: spies.getGitHubUserProfile,
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: spies.installGlobalSkills,
}));

mock.module("@/lib/skills/session-user-skills", () => ({
  installSessionUserSkills: spies.installSessionUserSkills,
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: spies.kickSandboxLifecycleWorkflow,
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: spies.buildActiveLifecycleUpdate,
  getNextLifecycleVersion: spies.getNextLifecycleVersion,
}));

mock.module("@/app/workflows/chat-sandbox-runtime", () => ({
  buildSandboxState: (session: ReturnType<typeof makeTestSession>) => ({
    type: "vercel" as const,
    sandboxName: `session_${session.id}`,
  }),
  getGitUser: spies.getGitUser,
  installSessionGlobalSkills: async (params: {
    session: ReturnType<typeof makeTestSession>;
    sandbox: Sandbox;
    didSetupWorkspace: boolean;
  }) => {
    // Faithful to the real installer: a no-op when didSetupWorkspace is false.
    if (!params.didSetupWorkspace) {
      return;
    }
    return spies.installGlobalSkills({
      sandbox: params.sandbox,
      globalSkillRefs: params.session.globalSkillRefs ?? [],
    });
  },
}));

mock.module("@/lib/sandbox/config", () => ({
  SANDBOX_SNAPSHOT_EXPIRATION_MS: 604_800_000,
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: null,
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 300_000,
  DEFAULT_SANDBOX_VCPUS: 2,
}));

// ── Test session factory ───────────────────────────────────────────────────────

type TestSession = {
  id: string;
  userId: string;
  status: "running" | "completed" | "failed" | "archived";
  sandboxState: SandboxState | null;
  repoOwner: string | null;
  repoName: string | null;
  cloneUrl: string | null;
  branch: string | null;
  isNewBranch: boolean | null;
  prNumber: number | null;
  fullClone: boolean;
  lifecycleVersion: number | null;
  globalSkillRefs: string[];
};

function makeTestSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    id: "test-session",
    userId: "user-1",
    status: "running",
    sandboxState: INACTIVE_SANDBOX_STATE,
    repoOwner: "acme",
    repoName: "my-repo",
    cloneUrl: "https://github.com/acme/my-repo.git",
    branch: "main",
    isNewBranch: null,
    prNumber: null,
    fullClone: false,
    lifecycleVersion: 0,
    globalSkillRefs: [],
    ...overrides,
  };
}

// ── Import module under test (after all mocks) ─────────────────────────────────

const { prewarmSessionSandbox } = await import("./prewarm");

// ── Helpers ────────────────────────────────────────────────────────────────────

const originalConsoleError = console.error;
const consoleErrorSpy = mock(() => {});

afterAll(() => {
  console.error = originalConsoleError;
});

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.values(spies).forEach((spy) => spy.mockClear());
  spies.getSessionById.mockImplementation(async () => null);
  spies.isSandboxActive.mockImplementation(() => false);
  spies.verifyRepoAccess.mockImplementation(async () => ({
    ok: true as const,
    installationId: 42,
    repositoryId: 99,
  }));
  spies.mintInstallationToken.mockImplementation(async () => ({
    token: "fake-token",
    tokenId: "tok_1",
    expiresAt: new Date(),
  }));
  spies.connectSandbox.mockImplementation(
    async () => fakeSandbox as unknown as Sandbox,
  );
  spies.buildActiveLifecycleUpdate.mockImplementation(() => ({
    lifecycleState: "active",
  }));
  spies.getNextLifecycleVersion.mockImplementation(() => 1);
  console.error = consoleErrorSpy as typeof console.error;
});

describe("prewarmSessionSandbox", () => {
  describe("BT-001: session not found", () => {
    test("returns skipped with reason session-not-found when session missing", async () => {
      spies.getSessionById.mockImplementationOnce(async () => null);

      const result = await prewarmSessionSandbox({
        sessionId: "nonexistent",
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "session-not-found",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-002: unauthorized", () => {
    test("returns skipped with reason unauthorized when userId mismatch", async () => {
      const session = makeTestSession({ userId: "user-2" });
      spies.getSessionById.mockImplementationOnce(async () => session);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "unauthorized",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-003: archived session", () => {
    test("returns skipped with reason archived when session is archived", async () => {
      const session = makeTestSession({ status: "archived" });
      spies.getSessionById.mockImplementationOnce(async () => session);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "archived",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-004: sandbox-free session", () => {
    test("returns skipped with reason sandbox-free when sandboxState is null", async () => {
      const session = makeTestSession({ sandboxState: null });
      spies.getSessionById.mockImplementationOnce(async () => session);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "sandbox-free",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });

    test("returns skipped with reason sandbox-free when sandboxState has no type:vercel", async () => {
      // But what if the type is wrong? We test with an object missing type:
      // Actually for sandbox-free we just check isSandboxState — null sandboxState
      // We already test null above. The key check is: type !== "vercel" → sandbox-free.
      // Let's test that a non-vercel sandboxState is treated as sandbox-free.
      const session2 = makeTestSession({
        sandboxState: { type: "vercel" }, // valid vercel state
      });
      // Override with non-vercel type by casting
      (session2 as { sandboxState: { type: string } }).sandboxState = {
        type: "unknown",
      };
      spies.getSessionById.mockImplementationOnce(
        async () => session2 as unknown as TestSession,
      );

      const result = await prewarmSessionSandbox({
        sessionId: session2.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "sandbox-free",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-005: already-active sandbox", () => {
    test("returns skipped with reason already-active when isSandboxActive is true", async () => {
      const session = makeTestSession({ sandboxState: ACTIVE_SANDBOX_STATE });
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.isSandboxActive.mockImplementation(() => true);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "already-active",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-006: eligible session — full prewarm", () => {
    test("calls connectSandbox, persists active state, installs skills, kicks lifecycle, returns prewarmed", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.isSandboxActive.mockImplementation(() => false);
      spies.buildActiveLifecycleUpdate.mockImplementation(() => ({
        lifecycleState: "active" as const,
        lastActivityAt: new Date(),
      }));
      spies.getNextLifecycleVersion.mockImplementation(() => 1);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("prewarmed");

      // connectSandbox was called
      expect(spies.connectSandbox).toHaveBeenCalledTimes(1);

      // updateSession was called with sandboxState and lifecycle fields
      expect(spies.updateSession).toHaveBeenCalledTimes(1);
      const updateCall = spies.updateSession.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(updateCall[0]).toBe(session.id);
      expect(updateCall[1]).toHaveProperty("sandboxState");
      expect(updateCall[1]).toHaveProperty("snapshotUrl", null);
      expect(updateCall[1]).toHaveProperty("snapshotCreatedAt", null);
      expect(updateCall[1]).toHaveProperty("lifecycleVersion", 1);

      // Global skills installed with didSetupWorkspace: true
      expect(spies.installGlobalSkills).toHaveBeenCalled();

      // User skills installed with didSetupWorkspace: true
      expect(spies.installSessionUserSkills).toHaveBeenCalledTimes(1);
      const userSkillsCall = spies.installSessionUserSkills.mock
        .calls[0] as unknown as [Record<string, unknown>];
      expect(userSkillsCall[0]).toMatchObject({ didSetupWorkspace: true });

      // Lifecycle kicked
      expect(spies.kickSandboxLifecycleWorkflow).toHaveBeenCalledTimes(1);
      const lifecycleCall = spies.kickSandboxLifecycleWorkflow.mock
        .calls[0] as unknown as [Record<string, unknown>];
      expect(lifecycleCall[0]).toMatchObject({
        sessionId: session.id,
        reason: "sandbox-created",
      });
    });
  });

  describe("BT-011: warm resume skips global-skill reinstall", () => {
    test("does not reinstall global skills when connect resumes an existing sandbox (wasCreated=false), but still refreshes user skills", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.isSandboxActive.mockImplementation(() => false);
      spies.connectSandbox.mockImplementationOnce(
        async () =>
          ({ ...fakeSandbox, wasCreated: false }) as unknown as Sandbox,
      );

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("prewarmed");
      expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
      // Snapshot already carries the global skills — do not pay to reinstall.
      expect(spies.installGlobalSkills).not.toHaveBeenCalled();
      // User skills still refresh so hibernated-toggle changes take effect.
      expect(spies.installSessionUserSkills).toHaveBeenCalledTimes(1);
    });
  });

  describe("BT-007: fullClone option", () => {
    test("passes cloneDepth:0 to connectSandbox when session.fullClone is true", async () => {
      const session = makeTestSession({ fullClone: true });
      spies.getSessionById.mockImplementationOnce(async () => session);

      await prewarmSessionSandbox({ sessionId: session.id, userId: "user-1" });

      expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
      const connectCall = spies.connectSandbox.mock.calls[0] as unknown as [
        { options: Record<string, unknown> },
      ];
      expect(connectCall[0].options).toHaveProperty("cloneDepth", 0);
    });
  });

  describe("BT-008: default shallow clone", () => {
    test("omits cloneDepth from connectSandbox when session.fullClone is false", async () => {
      const session = makeTestSession({ fullClone: false });
      spies.getSessionById.mockImplementationOnce(async () => session);

      await prewarmSessionSandbox({ sessionId: session.id, userId: "user-1" });

      expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
      const connectCall = spies.connectSandbox.mock.calls[0] as unknown as [
        { options: Record<string, unknown> },
      ];
      expect(connectCall[0].options).not.toHaveProperty("cloneDepth");
    });
  });

  describe("BT-009: repo access failure", () => {
    test("returns failed when repo access check fails; connectSandbox NOT called", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.verifyRepoAccess.mockImplementationOnce(async () => ({
        ok: false as const,
        reason: "installation-not-found" as const,
      }));
      spies.getRepoAccessErrorMessage.mockImplementationOnce(
        () => "repo not accessible",
      );

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("failed");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "repo not accessible",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("BT-010: token lifecycle", () => {
    test("mints token with contents:read and always revokes it in finally", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);

      await prewarmSessionSandbox({ sessionId: session.id, userId: "user-1" });

      expect(spies.mintInstallationToken).toHaveBeenCalledTimes(1);
      const mintCall = spies.mintInstallationToken.mock.calls[0] as unknown as [
        { permissions: Record<string, string> },
      ];
      expect(mintCall[0].permissions).toMatchObject({ contents: "read" });

      expect(spies.revokeInstallationToken).toHaveBeenCalledTimes(1);
    });

    test("revokes token even when connectSandbox throws", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.connectSandbox.mockImplementationOnce(async () => {
        throw new Error("connect failed");
      });

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      // Revoked in finally
      expect(spies.revokeInstallationToken).toHaveBeenCalledTimes(1);
      // Failed gracefully
      expect(result.status).toBe("failed");
    });
  });

  describe("BT-011: getGitUser runs concurrently with the repo-access/token chain", () => {
    test("both getGitUser and verifyRepoAccess start before either finishes, and prewarm still returns prewarmed", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);

      const callOrder: string[] = [];
      spies.getGitUser.mockImplementationOnce(async (_userId: string) => {
        callOrder.push("getGitUser:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        callOrder.push("getGitUser:end");
        return { name: "Test User", email: "test@example.com" };
      });
      spies.verifyRepoAccess.mockImplementationOnce(async () => {
        callOrder.push("verifyRepoAccess:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        callOrder.push("verifyRepoAccess:end");
        return {
          ok: true as const,
          installationId: 42,
          repositoryId: 99,
        };
      });

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("prewarmed");
      expect(spies.getGitUser).toHaveBeenCalledTimes(1);
      expect(spies.verifyRepoAccess).toHaveBeenCalledTimes(1);
      // If the two were run sequentially, the first call would fully finish
      // (both its start and end) before the second call ever starts. Running
      // concurrently means both starts happen before either end.
      expect(callOrder.slice(0, 2).sort()).toEqual(
        ["getGitUser:start", "verifyRepoAccess:start"].sort(),
      );
    });
  });

  describe("BT-012: fire-and-forget token revocation", () => {
    test("a revoke failure is caught and logged, and does not fail an otherwise successful prewarm", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.revokeInstallationToken.mockImplementationOnce(async () => {
        throw new Error("revoke failed");
      });

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("prewarmed");

      // Give the fire-and-forget revoke a tick to run and be caught.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spies.revokeInstallationToken).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[prewarm] Failed to revoke setup token:",
        expect.any(Error),
      );
    });

    test("when connectSandbox rejects, revokeInstallationToken is still eventually called", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.connectSandbox.mockImplementationOnce(async () => {
        throw new Error("connect failed");
      });

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("failed");

      // revokeInstallationToken is fired-and-forgotten; allow a tick for it
      // to be invoked before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spies.revokeInstallationToken).toHaveBeenCalledTimes(1);
    });
  });

  // ── Regression tests ────────────────────────────────────────────────────────

  describe("REG-001: sandbox-free detection must be strict — non-vercel type is NOT provisioned", () => {
    test("session with object sandboxState but type !== vercel returns sandbox-free, NOT prewarmed", async () => {
      // If sandbox-free guard breaks (e.g., removed isSandboxState check),
      // a non-vercel sandboxState would pass the guard and prewarm would be attempted.
      const session = makeTestSession();
      (session as unknown as { sandboxState: { type: string } }).sandboxState =
        { type: "not-vercel" };
      spies.getSessionById.mockImplementationOnce(async () => session);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "sandbox-free",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("REG-002: updateSession must persist sandboxState from sandbox.getState() when available", () => {
    test("updateSession receives the active state returned by sandbox.getState()", async () => {
      const session = makeTestSession();
      spies.getSessionById.mockImplementationOnce(async () => session);

      // The fake sandbox returns ACTIVE_SANDBOX_STATE from getState()
      await prewarmSessionSandbox({ sessionId: session.id, userId: "user-1" });

      const updateCall = spies.updateSession.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      // The sandboxState written must be the active state (from sandbox.getState())
      const savedState = updateCall[1].sandboxState as SandboxState;
      expect(savedState).toEqual(ACTIVE_SANDBOX_STATE);
    });
  });

  describe("REG-003: prewarm must NOT re-provision if sandbox is already active", () => {
    test("connectSandbox is NOT called when isSandboxActive returns true", async () => {
      const session = makeTestSession({ sandboxState: ACTIVE_SANDBOX_STATE });
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.isSandboxActive.mockImplementationOnce(() => true);

      const result = await prewarmSessionSandbox({
        sessionId: session.id,
        userId: "user-1",
      });

      expect(result.status).toBe("skipped");
      expect((result as { status: string; reason?: string }).reason).toBe(
        "already-active",
      );
      expect(spies.connectSandbox).not.toHaveBeenCalled();
    });
  });

  describe("REG-004: installSessionUserSkills must always receive userId, sessionId, and didSetupWorkspace:true", () => {
    test("user skills call includes all required identity fields", async () => {
      const session = makeTestSession({
        id: "reg-session",
        userId: "reg-user",
      });
      spies.getSessionById.mockImplementationOnce(async () => session);

      await prewarmSessionSandbox({
        sessionId: "reg-session",
        userId: "reg-user",
      });

      expect(spies.installSessionUserSkills).toHaveBeenCalledTimes(1);
      const skillsCall = spies.installSessionUserSkills.mock
        .calls[0] as unknown as [Record<string, unknown>];
      expect(skillsCall[0]).toMatchObject({
        userId: "reg-user",
        sessionId: "reg-session",
        didSetupWorkspace: true,
      });
    });
  });

  // #1399: skill-install rejection must not orphan a running VM — persist
  // sandboxState first, keep prewarm successful, kick lifecycle, and emit
  // prewarm.install_failed_state_preserved.
  describe("REG-1399: skill install failure preserves sandbox state", () => {
    test("persists sandboxState, kicks lifecycle, and returns prewarmed when global skill install rejects", async () => {
      const session = makeTestSession({ id: "session-install-fail" });
      spies.getSessionById.mockImplementationOnce(async () => session);
      spies.installGlobalSkills.mockImplementationOnce(async () => {
        throw new Error("npx skills add failed");
      });

      const warnSpy = mock((..._args: unknown[]) => undefined);
      const originalWarn = console.warn;
      console.warn = warnSpy as typeof console.warn;

      try {
        const result = await prewarmSessionSandbox({
          sessionId: session.id,
          userId: "user-1",
        });

        expect(result.status).toBe("prewarmed");
        expect(spies.updateSession).toHaveBeenCalledTimes(1);
        const updateCall = spies.updateSession.mock.calls[0] as unknown as [
          string,
          Record<string, unknown>,
        ];
        expect(updateCall[0]).toBe(session.id);
        expect(updateCall[1]).toHaveProperty("sandboxState");
        expect(spies.kickSandboxLifecycleWorkflow).toHaveBeenCalledTimes(1);

        const warnPayloads = warnSpy.mock.calls.map((call) => {
          const first = call[0];
          if (typeof first !== "string") {
            return null;
          }
          try {
            return JSON.parse(first) as Record<string, unknown>;
          } catch {
            return null;
          }
        });
        expect(warnPayloads).toContainEqual(
          expect.objectContaining({
            service: "sandbox-lifecycle",
            event: "prewarm.install_failed_state_preserved",
            sessionId: session.id,
            skillId: "global",
            errorKind: "skill_install_failed",
          }),
        );
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});
