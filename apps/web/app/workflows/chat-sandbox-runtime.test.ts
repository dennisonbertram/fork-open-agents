/**
 * Unit tests for resolveChatSandboxRuntime.
 *
 * BT-001: session.sandboxState === null → returns sandbox-free runtime, connectSandbox NOT called.
 * BT-002: session.sandboxState non-null (active) → resumes sandbox, connectSandbox IS called.
 * BT-003 (#811): unresolvable profile ⇒ typed throw BEFORE provisioning (fail-closed resolution).
 * BT-004 (#811): profile with non-default ports ⇒ connectSandbox receives profile-derived ports.
 * BT-005 (#811): required verification failure ⇒ throws typed error, run finishes "blocked" with errorKind.
 * BT-006 (#811): sandbox.exec THROWS during setup ⇒ failed observation appended + run finished "failed".
 * BT-007 (#811): startup notes read "will run setup, then verify" — never "installs".
 * BT-008 (#811): classic-mode provisioning is unchanged — still uses DEFAULT_SANDBOX_PORTS.
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
};

// The mocked `isSandboxActive` below (see the "@/lib/sandbox/utils" mock)
// treats a `status: "running"` field as "the sandbox is live" — that's what
// makes resolveChatSandboxRuntime take the warm-reconnect path
// (didSetupWorkspace === false). ACTIVE_SANDBOX_STATE above deliberately
// lacks that field, so every existing test using it exercises the cold
// (didSetupWorkspace === true) path despite its name.
const WARM_ACTIVE_SANDBOX_STATE = {
  type: "vercel",
  sandboxName: "session_warm-session",
  sandboxId: "sbx_warm",
  expiresAt: Date.now() + 60_000,
  status: "running",
} as unknown as SandboxState;

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

const connectSandboxSpy = mock(
  async (_params: Record<string, unknown>) => fakeSandbox as unknown as Sandbox,
);

// ── Configurable exec spy for setup/verification command behavior ──────────────

type ExecResult = Awaited<ReturnType<Sandbox["exec"]>>;

let execImpl: (command: string) => Promise<ExecResult> | ExecResult = () =>
  Promise.resolve({
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    truncated: false,
  });

const execSpy = mock(async (command: string) => execImpl(command));

fakeSandbox.exec = ((command: string) =>
  execSpy(command)) as unknown as Sandbox["exec"];

// Module mocks — must be declared before the module under test is imported.

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxSpy,
}));

const DEFAULT_BUILT_IN_PROFILE = {
  id: "test-profile",
  version: "1.0",
  displayName: "Test Profile",
  setupCommands: [],
  verificationCommands: [],
  expectedTools: [],
  optionalTools: [],
  defaultPorts: [3000],
};

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  getManagedRuntimeProfile: () => DEFAULT_BUILT_IN_PROFILE,
}));

mock.module("workflow", () => ({
  getWritable: () => new WritableStream({ write() {} }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async (id: string) => testSessionById[id] ?? null,
  updateSession: async () => undefined,
}));

type VerifyRepoAccessResult =
  | { ok: true; installationId: number; repositoryId: number }
  | { ok: false; reason: string };

let verifyRepoAccessResult: VerifyRepoAccessResult = {
  ok: true,
  installationId: 1,
  repositoryId: 1,
};

const verifyRepoAccessSpy = mock(
  async (_params: Record<string, unknown>) => verifyRepoAccessResult,
);

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessSpy,
  getRepoAccessErrorMessage: () => "repo access error",
}));

const mintInstallationTokenSpy = mock(
  async (_params: Record<string, unknown>) => ({
    token: "fake-token",
    tokenId: "tok_1",
    expiresAt: new Date(),
  }),
);
const revokeInstallationTokenSpy = mock(async (_token: string) => undefined);

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mintInstallationTokenSpy,
  revokeInstallationToken: revokeInstallationTokenSpy,
}));

const getGitHubUserProfileSpy = mock(async (_userId: string) => null);

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: getGitHubUserProfileSpy,
}));

const emitSessionEventSpy = mock(
  async (_params: Record<string, unknown>) => null,
);

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: emitSessionEventSpy,
}));

const NEXT_ACTION_BY_ERROR_KIND: Record<string, string> = {
  profile_not_found:
    "This profile no longer exists. Choose another profile or recreate it.",
  setup_command_failed:
    "Fix the failing setup command in the profile editor, then run setup again.",
  verification_failed:
    "Fix the failing verification command in the profile editor, then re-run verification.",
  setup_exec_error:
    "The setup command could not run in the sandbox. Check the sandbox status and try again.",
  evidence_write_failed:
    "Evidence for this run could not be saved. Re-run the profile to try recording evidence again.",
};

mock.module("@/lib/managed-runtime/profile-run-status", () => ({
  nextActionFor: (kind: string) => NEXT_ACTION_BY_ERROR_KIND[kind],
  rollupFromObservations: () => "passed",
}));

type ProfileResolution =
  | {
      ok: true;
      profile: {
        id: string;
        version: string;
        displayName: string;
        setupCommands: unknown[];
        verificationCommands: unknown[];
        expectedTools: string[];
        optionalTools: string[];
        defaultPorts: number[];
      };
      source: "built_in" | "session" | "user_default";
      requestedProfileId: string;
      resolvedProfileId: string;
    }
  | {
      ok: false;
      kind: "profile_not_found" | "profile_scope_mismatch";
      requestedProfileId: string;
      nextAction: string;
    };

let resolveProfileResult: ProfileResolution = {
  ok: true,
  profile: DEFAULT_BUILT_IN_PROFILE,
  source: "built_in",
  requestedProfileId: "test-profile",
  resolvedProfileId: "test-profile",
};

const resolveManagedRuntimeProfileSpy = mock(async () => resolveProfileResult);

mock.module("@/lib/managed-runtime/profile-resolution", () => ({
  resolveManagedRuntimeProfile: resolveManagedRuntimeProfileSpy,
}));

let startManagedRuntimeProfileRunShouldFail = false;

const startManagedRuntimeProfileRunSpy = mock(
  async (_params: Record<string, unknown>) => {
    if (startManagedRuntimeProfileRunShouldFail) {
      throw new Error("profile run write failed");
    }
    return { id: "run_1" };
  },
);
const appendManagedRuntimeSetupResultSpy = mock(
  async (_params: Record<string, unknown>) => undefined,
);
const appendManagedRuntimeVerificationResultSpy = mock(
  async (_params: Record<string, unknown>) => undefined,
);
const finishManagedRuntimeProfileRunSpy = mock(
  async (_params: Record<string, unknown>) => undefined,
);

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  appendManagedRuntimeSetupResult: appendManagedRuntimeSetupResultSpy,
  appendManagedRuntimeVerificationResult:
    appendManagedRuntimeVerificationResultSpy,
  buildManagedRuntimeCommandObservation: (params: {
    command: { id: string; label: string; required?: boolean };
    status: string;
  }) => ({
    commandId: params.command.id,
    label: params.command.label,
    status: params.status,
    required: params.command.required ?? true,
  }),
  finishManagedRuntimeProfileRun: finishManagedRuntimeProfileRunSpy,
  startManagedRuntimeProfileRun: startManagedRuntimeProfileRunSpy,
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
  getNextLifecycleVersion: () => 1,
}));

const kickSandboxLifecycleWorkflowSpy = mock(() => undefined);
mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: kickSandboxLifecycleWorkflowSpy,
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
  isSandboxNotFoundError: (message: string) => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("status code 404") ||
      normalized.includes("sandbox not found")
    );
  },
}));

mock.module("@/lib/skills/directories", () => ({
  getSandboxSkillDirectories: async () => [],
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: async () => undefined,
}));

mock.module("@/lib/skills/session-user-skills", () => ({
  installSessionUserSkills: async () => undefined,
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => null,
  setCachedSkills: async () => undefined,
}));

mock.module("@open-agents/agent", () => ({
  discoverSkills: async () => [],
}));

const capturedStartupMessages: string[] = [];

mock.module("./workspace-startup-log", () => ({
  WorkspaceStartupReporter: class {
    constructor() {}
    async send(message: string) {
      capturedStartupMessages.push(message);
    }
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

function makeManagedRuntimeSession(
  overrides: Partial<TestSession> = {},
): TestSession {
  return {
    ...makeRepoSession({
      id: "session-managed-runtime",
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "test-profile",
    }),
    ...overrides,
  };
}

// ── Import the module under test (after all mocks are declared) ────────────────

const { resolveChatSandboxRuntime } = await import("./chat-sandbox-runtime");

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  connectSandboxSpy.mockClear();
  connectSandboxSpy.mockImplementation(
    async (_params: Record<string, unknown>) => fakeSandbox as unknown as Sandbox,
  );
  execSpy.mockClear();
  startManagedRuntimeProfileRunSpy.mockClear();
  appendManagedRuntimeSetupResultSpy.mockClear();
  appendManagedRuntimeVerificationResultSpy.mockClear();
  finishManagedRuntimeProfileRunSpy.mockClear();
  resolveManagedRuntimeProfileSpy.mockClear();
  emitSessionEventSpy.mockClear();
  verifyRepoAccessSpy.mockClear();
  mintInstallationTokenSpy.mockClear();
  revokeInstallationTokenSpy.mockClear();
  getGitHubUserProfileSpy.mockClear();
  verifyRepoAccessResult = {
    ok: true,
    installationId: 1,
    repositoryId: 1,
  };
  capturedStartupMessages.length = 0;
  startManagedRuntimeProfileRunShouldFail = false;
  execImpl = () =>
    Promise.resolve({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    });
  resolveProfileResult = {
    ok: true,
    profile: DEFAULT_BUILT_IN_PROFILE,
    source: "built_in",
    requestedProfileId: "test-profile",
    resolvedProfileId: "test-profile",
  };
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

  describe("regression: sandbox-free guard is never bypassed", () => {
    test("REG-001: connectSandbox is not called even when other session fields are set (userId, title, runtimeMode)", async () => {
      // This regression catches a revert of the sandboxState=null guard. If the
      // early return is removed, connectSandbox would be called regardless of
      // sandboxState.
      const session = makeSandboxFreeSession({
        id: "session-full-fields",
        title: "A legitimate chat with no sandbox",
        runtimeMode: "classic",
        repoOwner: null,
        repoName: null,
        cloneUrl: null,
      });
      testSessionById[session.id] = session;

      await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-reg-1",
      });

      expect(connectSandboxSpy).toHaveBeenCalledTimes(0);
    });

    test("REG-002: sandbox-free runtime has null sandboxState and correct mode discriminant", async () => {
      // If someone changes the return shape of the early return branch (e.g.
      // fabricates a SandboxState instead of returning null), this fails.
      const session = makeSandboxFreeSession({ id: "session-shape-check" });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-reg-2",
      });

      expect(result.mode).toBe("sandbox-free");
      expect(result.sandboxState).toBeNull();
      // Skills should be an empty array (no sandbox to load skills from)
      expect(result.skills).toEqual([]);
      // Common fields must be present
      expect(typeof result.sessionTitle).toBe("string");
      expect(typeof result.runtimeMode).toBe("string");
    });

    test("REG-003: auth checks execute before the sandbox-free early return", async () => {
      // If the sandbox-free guard is moved BEFORE auth checks, an unauthorized
      // user could get a sandbox-free runtime without being rejected.
      const session = makeSandboxFreeSession({ id: "session-auth-order" });
      testSessionById[session.id] = session;

      // User ID does NOT match session.userId
      await expect(
        resolveChatSandboxRuntime({
          userId: "attacker",
          sessionId: session.id,
          assistantId: "asst-reg-3",
        }),
      ).rejects.toThrow("Unauthorized");

      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });

    test("REG-004: archived sandbox-free session is still rejected before returning sandbox-free runtime", async () => {
      // Ensures archived check runs before early return for sandbox-free sessions.
      const session = makeSandboxFreeSession({
        id: "session-archived-free",
        status: "archived",
      });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-reg-4",
        }),
      ).rejects.toThrow("Session is archived");

      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("BT-003 (#811): unresolvable profile fails closed before provisioning", () => {
    test("throws a typed error and never calls connectSandbox", async () => {
      resolveProfileResult = {
        ok: false,
        kind: "profile_not_found",
        requestedProfileId: "missing-profile",
        nextAction: "Choose another profile or recreate it.",
      };
      const session = makeManagedRuntimeSession({
        id: "session-unresolvable-profile",
        managedRuntimeProfileId: "missing-profile",
      });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-bt3-1",
        }),
      ).rejects.toThrow();

      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });

    test("throws WorkspaceSetupError named error carrying the next action", async () => {
      resolveProfileResult = {
        ok: false,
        kind: "profile_not_found",
        requestedProfileId: "missing-profile",
        nextAction: "Choose another profile or recreate it.",
      };
      const session = makeManagedRuntimeSession({
        id: "session-unresolvable-profile-2",
        managedRuntimeProfileId: "missing-profile",
      });
      testSessionById[session.id] = session;

      let caught: unknown;
      try {
        await resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-bt3-2",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe("WorkspaceSetupError");
      expect((caught as Error).message).toContain(
        "Choose another profile or recreate it.",
      );
    });
  });

  describe("BT-004 (#811): connectSandbox receives profile-derived ports", () => {
    test("uses profile.defaultPorts, not DEFAULT_SANDBOX_PORTS, for managed runtime", async () => {
      resolveProfileResult = {
        ok: true,
        profile: { ...DEFAULT_BUILT_IN_PROFILE, defaultPorts: [8000] },
        source: "built_in",
        requestedProfileId: "test-profile",
        resolvedProfileId: "test-profile",
      };
      const session = makeManagedRuntimeSession({
        id: "session-custom-ports",
      });
      testSessionById[session.id] = session;

      await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-bt4-1",
      });

      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);
      const callArgs = connectSandboxSpy.mock.calls.at(0)?.[0] as {
        options: { ports: number[] };
      };
      expect(callArgs.options.ports).toEqual([8000]);
    });
  });

  describe("BT-005 (#811): required verification failure fails closed", () => {
    test("throws and finishes the profile run 'blocked' with errorKind verification_failed", async () => {
      resolveProfileResult = {
        ok: true,
        profile: {
          ...DEFAULT_BUILT_IN_PROFILE,
          setupCommands: [],
          verificationCommands: [
            {
              id: "verify-tool",
              label: "Verify tool",
              description: "Confirms tool availability.",
              command: "command -v tool",
              required: true,
            },
          ],
        },
        source: "built_in",
        requestedProfileId: "test-profile",
        resolvedProfileId: "test-profile",
      };
      execImpl = () =>
        Promise.resolve({
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "tool not found",
          truncated: false,
        });
      const session = makeManagedRuntimeSession({
        id: "session-verify-failed",
      });
      testSessionById[session.id] = session;
      kickSandboxLifecycleWorkflowSpy.mockClear();

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-bt5-1",
        }),
      ).rejects.toThrow();

      // Codex #832 P2: the lifecycle workflow must still be kicked even when
      // managed-runtime setup fails closed, or the provisioned persistent
      // sandbox is never hibernated/cleaned up.
      expect(kickSandboxLifecycleWorkflowSpy).toHaveBeenCalled();

      expect(finishManagedRuntimeProfileRunSpy).toHaveBeenCalled();
      const finishArgs = finishManagedRuntimeProfileRunSpy.mock.calls.at(
        0,
      )?.[0] as {
        status: string;
        errorKind?: string;
      };
      expect(finishArgs.status).toBe("blocked");
      expect(finishArgs.errorKind).toBe("verification_failed");
    });
  });

  describe("BT-006 (#811): sandbox.exec throwing during setup is captured as evidence", () => {
    test("appends a failed observation and finishes the run 'failed' before propagating", async () => {
      resolveProfileResult = {
        ok: true,
        profile: {
          ...DEFAULT_BUILT_IN_PROFILE,
          setupCommands: [
            {
              id: "install-thing",
              label: "Install thing",
              description: "Installs a thing.",
              command: "install-thing",
              required: true,
            },
          ],
          verificationCommands: [],
        },
        source: "built_in",
        requestedProfileId: "test-profile",
        resolvedProfileId: "test-profile",
      };
      execImpl = () => {
        throw new Error("sandbox exec transport failure");
      };
      const session = makeManagedRuntimeSession({
        id: "session-exec-throws",
      });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-bt6-1",
        }),
      ).rejects.toThrow();

      expect(appendManagedRuntimeSetupResultSpy).toHaveBeenCalled();
      const appendArgs = appendManagedRuntimeSetupResultSpy.mock.calls.at(
        0,
      )?.[0] as {
        observation: { status: string };
      };
      expect(appendArgs.observation.status).toBe("failed");

      expect(finishManagedRuntimeProfileRunSpy).toHaveBeenCalled();
      const finishArgs = finishManagedRuntimeProfileRunSpy.mock.calls.at(
        0,
      )?.[0] as {
        status: string;
        errorKind?: string;
      };
      expect(finishArgs.status).toBe("failed");
      expect(finishArgs.errorKind).toBe("setup_exec_error");
    });
  });

  describe("BT-007 (#811): startup copy is honest about what the profile does", () => {
    test("startup notes say 'will run setup, then verify' and never claim to 'install' tools", async () => {
      const session = makeManagedRuntimeSession({
        id: "session-honest-copy",
      });
      testSessionById[session.id] = session;

      await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-bt7-1",
      });

      const combined = capturedStartupMessages.join(" | ");
      expect(combined).toContain("will run setup, then verify");
      expect(combined).not.toMatch(/installs? .*bun/i);
    });
  });

  describe("BT-008 (#811): classic-mode provisioning is unchanged", () => {
    test("classic sessions still provision with DEFAULT_SANDBOX_PORTS", async () => {
      const session = makeRepoSession({ id: "session-classic-ports" });
      testSessionById[session.id] = session;

      await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-bt8-1",
      });

      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);
      const callArgs = connectSandboxSpy.mock.calls.at(0)?.[0] as {
        options: { ports: number[] };
      };
      expect(callArgs.options.ports).toEqual([3000]);
    });
  });

  describe("regression: managed runtime never silently falls back on resolution failure", () => {
    test("REG-005: an unresolvable profile never reaches SandboxBackedRuntime construction", async () => {
      resolveProfileResult = {
        ok: false,
        kind: "profile_not_found",
        requestedProfileId: "gone-profile",
        nextAction: "Choose another profile or recreate it.",
      };
      const session = makeManagedRuntimeSession({
        id: "session-reg-005",
        managedRuntimeProfileId: "gone-profile",
      });
      testSessionById[session.id] = session;

      let result: unknown;
      let threw = false;
      try {
        result = await resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-reg-5",
        });
      } catch {
        threw = true;
      }

      // If the fail-closed throw is reverted, this would silently resolve
      // to a SandboxBackedRuntime using the built-in default profile instead.
      expect(threw).toBe(true);
      expect(result).toBeUndefined();
    });

    test("REG-006 (D8): a failed startManagedRuntimeProfileRun warns visibly and continues instead of hard-failing or silently skipping all evidence", async () => {
      // If D8's warn-and-continue path regresses to either (a) swallowing the
      // failure with no visible warning (the pre-#811 behavior) or (b)
      // hard-failing the whole turn, this test fails: it asserts BOTH that
      // the turn still completes AND that a visible warning + evidence event
      // were emitted.
      startManagedRuntimeProfileRunShouldFail = true;
      const session = makeManagedRuntimeSession({
        id: "session-reg-006",
      });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-reg-6",
      });

      // The turn must still complete (warn, not hard-fail).
      expect(result.mode).toBe("sandbox");

      // A visible warning must have been surfaced via the startup reporter.
      const combined = capturedStartupMessages.join(" | ");
      expect(combined).toContain("evidence");
      expect(combined.toLowerCase()).toContain("could not be saved");

      // An evidence_unavailable event must have been attempted.
      const evidenceEventCall = emitSessionEventSpy.mock.calls.find((call) => {
        const arg = call[0] as { eventName?: string };
        return arg.eventName === "managed_runtime.profile.evidence_unavailable";
      });
      expect(evidenceEventCall).toBeDefined();
    });
  });

  describe("warm reconnect path (didSetupWorkspace === false, cloneUrl set): no GitHub token round-trip", () => {
    test("reconnects without minting or revoking an installation token, but still verifies repo access", async () => {
      const session = makeRepoSession({
        id: "session-warm-1",
        sandboxState: WARM_ACTIVE_SANDBOX_STATE,
      });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-warm-1",
      });

      expect(result.mode).toBe("sandbox");
      expect(mintInstallationTokenSpy).not.toHaveBeenCalled();
      expect(verifyRepoAccessSpy).toHaveBeenCalledTimes(1);
      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);

      const callArgs = connectSandboxSpy.mock.calls.at(0)?.[0] as {
        options: { githubToken?: string; createIfMissing: boolean };
      };
      expect(callArgs.options.githubToken).toBeUndefined();
      expect(callArgs.options.createIfMissing).toBe(false);

      // Nothing was ever minted, so nothing should ever be revoked either —
      // give any stray fire-and-forget revoke a tick to (not) happen.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(revokeInstallationTokenSpy).not.toHaveBeenCalled();
    });

    test("rejects when verifyRepoAccess resolves not-ok even though connect succeeded", async () => {
      verifyRepoAccessResult = { ok: false, reason: "revoked" };
      const session = makeRepoSession({
        id: "session-warm-2",
        sandboxState: WARM_ACTIVE_SANDBOX_STATE,
      });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-warm-2",
        }),
      ).rejects.toThrow("repo access error");

      // The connect itself succeeded — it's the security gate that failed.
      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);
      expect(mintInstallationTokenSpy).not.toHaveBeenCalled();
    });

    test("falls back to the cold flow (mint + recreate) when the warm connect 404s", async () => {
      connectSandboxSpy.mockImplementationOnce(async () => {
        throw new Error("Sandbox fetch failed with status code 404");
      });
      const session = makeRepoSession({
        id: "session-warm-404",
        sandboxState: WARM_ACTIVE_SANDBOX_STATE,
      });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-warm-404",
      });

      expect(result.mode).toBe("sandbox");
      expect(verifyRepoAccessSpy).toHaveBeenCalledTimes(1);
      expect(mintInstallationTokenSpy).toHaveBeenCalledTimes(1);
      expect(connectSandboxSpy).toHaveBeenCalledTimes(2);

      const secondCallArgs = connectSandboxSpy.mock.calls.at(1)?.[0] as {
        options: {
          githubToken?: string;
          gitUser?: unknown;
          createIfMissing: boolean;
        };
      };
      expect(secondCallArgs.options.githubToken).toBe("fake-token");
      expect(secondCallArgs.options.gitUser).toBeDefined();
      expect(secondCallArgs.options.createIfMissing).toBe(true);

      // The token minted for the recreate is still revoked eventually, even
      // though revocation is now fire-and-forget rather than awaited.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(revokeInstallationTokenSpy).toHaveBeenCalledTimes(1);
    });

    test("404 fallback still fails closed if repo access was revoked", async () => {
      connectSandboxSpy.mockImplementationOnce(async () => {
        throw new Error("Sandbox fetch failed with status code 404");
      });
      verifyRepoAccessResult = { ok: false, reason: "revoked" };
      const session = makeRepoSession({
        id: "session-warm-404-revoked",
        sandboxState: WARM_ACTIVE_SANDBOX_STATE,
      });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-warm-404-revoked",
        }),
      ).rejects.toThrow("repo access error");

      expect(mintInstallationTokenSpy).not.toHaveBeenCalled();
      // Only the initial (404ing) connect attempt — no recreate once access
      // is known to be revoked.
      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("cold path (didSetupWorkspace === true) is unchanged", () => {
    test("mints a token, passes it to connectSandbox, and eventually revokes it", async () => {
      const session = makeRepoSession({ id: "session-cold-1" });
      testSessionById[session.id] = session;

      const result = await resolveChatSandboxRuntime({
        userId: "user-1",
        sessionId: session.id,
        assistantId: "asst-cold-1",
      });

      expect(result.mode).toBe("sandbox");
      expect(verifyRepoAccessSpy).toHaveBeenCalledTimes(1);
      expect(mintInstallationTokenSpy).toHaveBeenCalledTimes(1);
      expect(connectSandboxSpy).toHaveBeenCalledTimes(1);

      const callArgs = connectSandboxSpy.mock.calls.at(0)?.[0] as {
        options: { githubToken?: string; createIfMissing: boolean };
      };
      expect(callArgs.options.githubToken).toBe("fake-token");
      expect(callArgs.options.createIfMissing).toBe(true);

      // Revocation is fire-and-forget now, so give it a tick to complete
      // rather than asserting it happened before resolveChatSandboxRuntime
      // returned.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(revokeInstallationTokenSpy).toHaveBeenCalledTimes(1);
    });

    test("rejects when verifyRepoAccess resolves not-ok before ever minting a token", async () => {
      verifyRepoAccessResult = { ok: false, reason: "revoked" };
      const session = makeRepoSession({ id: "session-cold-2" });
      testSessionById[session.id] = session;

      await expect(
        resolveChatSandboxRuntime({
          userId: "user-1",
          sessionId: session.id,
          assistantId: "asst-cold-2",
        }),
      ).rejects.toThrow("repo access error");

      expect(mintInstallationTokenSpy).not.toHaveBeenCalled();
      expect(connectSandboxSpy).not.toHaveBeenCalled();
    });
  });
});
