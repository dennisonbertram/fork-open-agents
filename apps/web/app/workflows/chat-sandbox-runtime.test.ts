import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const activeSandboxState = {
  type: "vercel" as const,
  sandboxId: "sbx-1",
  sandboxName: "sbx-1",
};
const inactiveSandboxState = { type: "vercel" as const };

let runtimeMode: "classic" | "managed_runtime" = "classic";
let provisioned = false;

const connectSandboxCalls: unknown[] = [];
const waitCalls: string[] = [];
const kickCalls: string[] = [];

function currentSession() {
  return {
    id: "session-1",
    userId: "user-1",
    status: "running" as const,
    title: "My session",
    runtimeMode,
    managedRuntimeProfileId: "web-bun-agent-browser",
    repoOwner: "vercel",
    repoName: "open-agents",
    branch: "main",
    cloneUrl: null,
    prNumber: null,
    isNewBranch: false,
    lifecycleVersion: 0,
    lifecycleError: null,
    globalSkillRefs: [],
    sandboxState: provisioned ? activeSandboxState : inactiveSandboxState,
  };
}

mock.module("@open-agents/agent", () => ({
  discoverSkills: async () => [],
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (arg: unknown) => {
    connectSandboxCalls.push(arg);
    return {
      workingDirectory: "/workspace",
      currentBranch: "main",
      environmentDetails: "env-details",
      getState: () => activeSandboxState,
      exec: async () => ({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    };
  },
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  getManagedRuntimeProfile: () => ({
    id: "web-bun-agent-browser",
    version: "1",
    displayName: "Web Bun Agent",
    expectedTools: [],
    optionalTools: [],
    setupCommands: [],
    verificationCommands: [],
  }),
}));

mock.module("workflow", () => ({
  getWritable: () => ({
    getWriter: () => ({
      write: async () => undefined,
      releaseLock: () => undefined,
    }),
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => currentSession(),
  updateSession: async () => null,
}));

mock.module("@/lib/sandbox/provisioning-kick", () => ({
  kickSandboxProvisioningWorkflow: async (sessionId: string) => {
    kickCalls.push(sessionId);
    return { status: "started", runId: `provision-${sessionId}` };
  },
  waitForSandboxProvisioningRun: async (runId: string) => {
    waitCalls.push(runId);
    provisioned = true;
    return { skipped: false, sandboxState: activeSandboxState };
  },
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: (state: { type?: string; sandboxId?: string } | null) =>
    Boolean(state && state.type === "vercel" && state.sandboxId),
  getResumableSandboxName: (state: { sandboxName?: string } | null) =>
    state?.sandboxName,
  getSessionSandboxName: (id: string) => `sandbox-${id}`,
}));

mock.module("@/lib/skills/directories", () => ({
  getSandboxSkillDirectories: async () => [],
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => null,
  setCachedSkills: async () => undefined,
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: async () => undefined,
}));

mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async () => undefined,
}));

mock.module("@/lib/managed-runtime/profile-resolution", () => ({
  resolveManagedRuntimeProfile: async () => ({
    id: "web-bun-agent-browser",
    version: "1",
    displayName: "Web Bun Agent",
    expectedTools: [],
    optionalTools: [],
    setupCommands: [],
    verificationCommands: [],
  }),
}));

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  appendManagedRuntimeSetupResult: async () => undefined,
  appendManagedRuntimeVerificationResult: async () => undefined,
  buildManagedRuntimeCommandObservation: () => ({}),
  finishManagedRuntimeProfileRun: async () => undefined,
  startManagedRuntimeProfileRun: async () => ({ id: "profile-run-1" }),
}));

// These are only used by the legacy inline-provision path; stub for safety.
mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => ({
    ok: true,
    installationId: 1,
    repositoryId: 2,
  }),
  getRepoAccessErrorMessage: () => "no access",
}));
mock.module("@/lib/github/app", () => ({
  mintInstallationToken: async () => ({ token: "ghs_secret" }),
  revokeInstallationToken: async () => undefined,
}));
mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async () => ({ username: "nico", externalUserId: "1" }),
}));
mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({ lifecycleState: "active" }),
  getNextLifecycleVersion: () => 1,
}));
mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: () => undefined,
}));

const modulePromise = import("./chat-sandbox-runtime");

describe("resolveChatSandboxRuntime", () => {
  beforeEach(() => {
    runtimeMode = "classic";
    provisioned = false;
    connectSandboxCalls.length = 0;
    waitCalls.length = 0;
    kickCalls.length = 0;
  });

  test("waits for the in-flight provisioning run and bare-reconnects", async () => {
    const { resolveChatSandboxRuntime } = await modulePromise;

    const result = await resolveChatSandboxRuntime({
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      assistantId: "assistant-1",
      workflowRunId: "wrun-1",
    });

    // It awaited the provisioning run that the kick reported.
    expect(kickCalls).toEqual(["session-1"]);
    expect(waitCalls).toEqual(["provision-session-1"]);

    // It bare-reconnected with the resolved SandboxState, not the
    // full-options provision form ({ state, options }).
    expect(connectSandboxCalls).toHaveLength(1);
    expect(connectSandboxCalls[0]).toEqual(activeSandboxState);
    expect(connectSandboxCalls[0]).not.toHaveProperty("options");

    expect(result.sandboxState).toEqual(activeSandboxState);
    expect(result.workingDirectory).toBe("/workspace");
  });
});
