import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type FakeSession = {
  id: string;
  userId: string;
  status: "running" | "archived";
  cloneUrl: string | null;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  prNumber: number | null;
  isNewBranch: boolean;
  sandboxState: {
    type: "vercel";
    sandboxId?: string;
    sandboxName?: string;
  } | null;
  lifecycleVersion: number;
  globalSkillRefs: string[];
};

let sessionRecord: FakeSession | null = null;
let updateIfNotArchivedResult: FakeSession | null = null;

const stopCalls: string[] = [];
const lifecycleKickCalls: Array<{ sessionId: string; reason: string }> = [];
const installSkillsCalls: number[] = [];
const revokeCalls: string[] = [];

const fakeSandbox = {
  workingDirectory: "/workspace",
  currentBranch: "main",
  environmentDetails: "env",
  getState: () => ({
    type: "vercel" as const,
    sandboxId: "sbx-1",
    sandboxName: "sandbox-1",
  }),
  stop: async () => {
    stopCalls.push("stop");
  },
  exec: async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" }),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => fakeSandbox,
}));

// Mock the db client so the real sessions helpers (getSessionById,
// updateSessionIfNotArchived) run against an in-memory fake.
mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => sessionRecord,
      },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "user-1",
              username: "nico",
              name: "Nico",
              email: "nico@example.com",
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () =>
            updateIfNotArchivedResult ? [updateIfNotArchivedResult] : [],
        }),
      }),
    }),
  },
}));

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
  revokeInstallationToken: async (token: string) => {
    revokeCalls.push(token);
  },
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUserProfile: async () => ({
    username: "nico",
    externalUserId: "123",
  }),
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: {
    sessionId: string;
    reason: string;
  }) => {
    lifecycleKickCalls.push(input);
  },
}));

mock.module("@/lib/skills/global-skill-installer", () => ({
  installGlobalSkills: async () => {
    installSkillsCalls.push(1);
  },
}));

const modulePromise = import("./provisioning");

function baseSession(): FakeSession {
  return {
    id: "session-1",
    userId: "user-1",
    status: "running",
    cloneUrl: "https://github.com/vercel/open-agents",
    repoOwner: "vercel",
    repoName: "open-agents",
    branch: "main",
    prNumber: null,
    isNewBranch: false,
    sandboxState: { type: "vercel" },
    lifecycleVersion: 0,
    globalSkillRefs: ["vercel/ai"],
  };
}

describe("provisionSessionSandbox", () => {
  beforeEach(() => {
    sessionRecord = baseSession();
    updateIfNotArchivedResult = {
      ...baseSession(),
      sandboxState: fakeSandbox.getState(),
    };
    stopCalls.length = 0;
    lifecycleKickCalls.length = 0;
    installSkillsCalls.length = 0;
    revokeCalls.length = 0;
  });

  test("provisions, persists, and kicks the lifecycle workflow exactly once", async () => {
    const { provisionSessionSandbox } = await modulePromise;

    const result = await provisionSessionSandbox({ sessionId: "session-1" });

    expect(result.sandboxState).toMatchObject({
      type: "vercel",
      sandboxId: "sbx-1",
    });
    expect(result.didSetupWorkspace).toBe(true);
    expect(lifecycleKickCalls).toEqual([
      { sessionId: "session-1", reason: "sandbox-created" },
    ]);
    // Setup token is always revoked after the connect attempt.
    expect(revokeCalls).toEqual(["ghs_secret"]);
  });

  test("stops the sandbox and throws when the session is archived mid-provisioning", async () => {
    const { provisionSessionSandbox, SessionArchivedDuringProvisioningError } =
      await modulePromise;

    // Simulate the archive race: the conditional persist returns no row.
    updateIfNotArchivedResult = null;

    await expect(
      provisionSessionSandbox({ sessionId: "session-1" }),
    ).rejects.toBeInstanceOf(SessionArchivedDuringProvisioningError);

    expect(stopCalls).toEqual(["stop"]);
    // Lifecycle must not be kicked for an archived session.
    expect(lifecycleKickCalls).toHaveLength(0);
  });
});
