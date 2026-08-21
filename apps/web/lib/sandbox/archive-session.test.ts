import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  status: "running" | "archived";
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  sandboxState: {
    type: "vercel";
    sandboxName?: string;
    expiresAt?: number;
  } | null;
  snapshotUrl: string | null;
  lifecycleState: "active" | "archived" | null;
  lifecycleError: string | null;
  sandboxExpiresAt: Date | null;
  hibernateAfter: Date | null;
}

interface MockSandboxExecResult {
  success: boolean;
  stdout: string;
}

interface MockSandbox {
  workingDirectory: string;
  exec: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<MockSandboxExecResult>;
  stop: () => Promise<void>;
  snapshot?: () => Promise<{ snapshotId: string }>;
}

type MockPullRequestStatusResult =
  | {
      success: true;
      status: "open" | "merged" | "closed";
    }
  | {
      success: false;
      error: string;
    };

type MockFindPullRequestResult =
  | {
      found: true;
      prNumber: number;
      prStatus: "open" | "merged" | "closed";
    }
  | {
      found: false;
      error?: string;
    };

let sessionRecord: TestSessionRecord | null = null;
let sandboxQueue: MockSandbox[] = [];

const spies = {
  getSessionById: mock(async (_sessionId: string) => {
    if (!sessionRecord) {
      return null;
    }

    return {
      ...sessionRecord,
      sandboxState: sessionRecord.sandboxState
        ? { ...sessionRecord.sandboxState }
        : null,
    };
  }),
  updateSession: mock(
    async (_sessionId: string, patch: Record<string, unknown>) => {
      if (!sessionRecord) {
        return null;
      }

      sessionRecord = {
        ...sessionRecord,
        ...(patch as Partial<TestSessionRecord>),
      };

      return {
        ...sessionRecord,
        sandboxState: sessionRecord.sandboxState
          ? { ...sessionRecord.sandboxState }
          : null,
      };
    },
  ),
  connectSandbox: mock(async () => {
    const sandbox = sandboxQueue.shift();
    if (!sandbox) {
      throw new Error("sandbox connection failed");
    }

    return sandbox;
  }),
  getUserGitHubToken: mock(async () => "repo-token"),
  getPullRequestStatus: mock(
    async (): Promise<MockPullRequestStatusResult> => ({
      success: false,
      error: "Failed to get PR status",
    }),
  ),
  findPullRequest: mock(
    async (): Promise<MockFindPullRequestResult> => ({
      found: false,
    }),
  ),
};

mock.module("@/lib/db/sessions", () => ({
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: spies.getUserGitHubToken,
}));

mock.module("@/lib/github/pulls", () => ({
  getPullRequestStatus: spies.getPullRequestStatus,
  findPullRequest: spies.findPullRequest,
}));

const archiveSessionModulePromise = import("./archive-session");

function makeSessionRecord(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    status: "running",
    repoOwner: "acme",
    repoName: "widgets",
    branch: "feature/session-1",
    cloneUrl: "https://github.com/acme/widgets.git",
    prNumber: 42,
    prStatus: "open",
    sandboxState: {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: Date.now() + 60_000,
    },
    snapshotUrl: null,
    lifecycleState: "active",
    lifecycleError: null,
    sandboxExpiresAt: new Date("2025-01-01T00:00:00.000Z"),
    hibernateAfter: new Date("2025-01-01T00:10:00.000Z"),
    ...overrides,
  };
}

function createMockSandbox(overrides: Partial<MockSandbox> = {}): MockSandbox {
  return {
    workingDirectory: "/workspace",
    exec: async () => ({ success: true, stdout: "feature/session-1\n" }),
    stop: async () => {},
    ...overrides,
  };
}

beforeEach(() => {
  sessionRecord = makeSessionRecord();
  sandboxQueue = [];
  Object.values(spies).forEach((spy) => spy.mockClear());

  spies.getUserGitHubToken.mockImplementation(async () => "repo-token");
  spies.getPullRequestStatus.mockImplementation(async () => ({
    success: false,
    error: "Failed to get PR status",
  }));
  spies.findPullRequest.mockImplementation(async () => ({
    found: false,
  }));
});

describe("archiveSession", () => {
  // #1395 defect 2 — the resume handle (sandboxState) must only be cleared
  // once sandbox.stop() has actually succeeded. When connecting to the
  // sandbox fails outright (as here, via the empty sandboxQueue), stop()
  // never even ran, so clearing the handle would make the sandbox
  // permanently unstoppable by lifecycle. Preserve it so a later pass can
  // retry.
  test("preserves runtime sandbox state when archive finalization fails to connect", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls).toHaveLength(2);
    const recoveryPatch = updateCalls[1]?.[1];

    expect(recoveryPatch).toMatchObject({
      lifecycleState: "archived",
      sandboxExpiresAt: null,
      hibernateAfter: null,
      lifecycleError: "Archive finalization failed: sandbox connection failed",
    });
    expect(recoveryPatch?.sandboxState).toBeUndefined();

    expect(sessionRecord?.sandboxState).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_session-1",
      }),
    );
  });

  // #1395 defect 2 — same preservation requirement when we DO connect to the
  // sandbox but sandbox.stop() itself throws. This is the scenario the issue
  // calls out explicitly: stop() failing must never clear the only handle
  // that could be used to retry it.
  test("preserves runtime sandbox state when sandbox.stop() fails", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    // Two sandboxes are consumed in order: one by refreshArchiveGitState
    // (called synchronously by archiveSession before the update), and one by
    // finalizeArchivedSessionSandbox's stop attempt in the background task.
    sandboxQueue = [
      createMockSandbox(),
      createMockSandbox({
        stop: async () => {
          throw new Error("sdk.stop() failed transiently");
        },
      }),
    ];

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls).toHaveLength(2);
    const recoveryPatch = updateCalls[1]?.[1];

    expect(recoveryPatch).toMatchObject({
      lifecycleState: "archived",
      sandboxExpiresAt: null,
      hibernateAfter: null,
      lifecycleError:
        "Archive finalization failed: sdk.stop() failed transiently",
    });
    expect(recoveryPatch?.sandboxState).toBeUndefined();

    expect(sessionRecord?.sandboxState).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_session-1",
        expiresAt: expect.any(Number),
      }),
    );
  });

  test("preserves runtime sandbox state when archive finalization fails but snapshot already exists", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    sessionRecord = makeSessionRecord({ snapshotUrl: "snapshot-existing" });

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls).toHaveLength(2);
    const recoveryPatch = updateCalls[1]?.[1];

    expect(recoveryPatch?.lifecycleError).toBe(
      "Archive finalization failed: sandbox connection failed",
    );
    expect(recoveryPatch?.sandboxState).toBeUndefined();
    expect(sessionRecord?.sandboxState).toEqual(
      expect.objectContaining({
        type: "vercel",
        sandboxName: "session_session-1",
      }),
    );
  });

  test("refreshes merged PR status before archiving", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    sandboxQueue = [createMockSandbox(), createMockSandbox()];
    spies.getPullRequestStatus.mockImplementation(async () => ({
      success: true,
      status: "merged",
    }));

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls[0]?.[1]).toMatchObject({
      status: "archived",
      prStatus: "merged",
    });
    expect(spies.findPullRequest).not.toHaveBeenCalled();
    expect(sessionRecord?.prStatus).toBe("merged");
  });
});
