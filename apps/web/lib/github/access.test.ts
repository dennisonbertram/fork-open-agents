import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Mock state ─────────────────────────────────────────────────────────────────

// The user octokit returned by getUserOctokit.
// Set to null to simulate missing token.
let mockUserOctokit: {
  rest: {
    repos: {
      get: (_args: unknown) => Promise<{
        data: {
          id: number;
          default_branch: string;
          permissions?: {
            admin: boolean;
            maintain?: boolean;
            push: boolean;
            pull?: boolean;
          };
        };
      }>;
    };
  };
} | null = null;

// The installation row returned by getInstallationByAccountLogin.
// Set to undefined to simulate missing installation.
let mockInstallationRow: { installationId: number } | undefined = {
  installationId: 42,
};

// Controls whether the installation-scoped octokit check succeeds or throws.
let mockScopedOctokitShouldFail = false;
let mockScopedOctokitFailStatus = 404;

// Resync collaborators (issue #791). By default, resync is never reached in
// the pre-existing tests because mockInstallationRow is populated; the new
// "installation resync" describe block below overrides these per test.
let mockUserToken: string | null = "user-token";
let mockUsername: string | null = "octocat";
let mockSyncUserInstallations: (
  userId: string,
  userToken: string,
  personalAccountLogin: string,
) => Promise<number> = async () => 0;
let mockInstallationRowAfterResync: { installationId: number } | undefined;
let syncUserInstallationsCallCount = 0;
let getInstallationByAccountLoginCallCount = 0;

// ── Module mocks ───────────────────────────────────────────────────────────────

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async (_userId: string) => mockUserOctokit,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationByAccountLogin: async (
    _userId: string,
    _accountLogin: string,
  ) => {
    getInstallationByAccountLoginCallCount += 1;
    // First call always returns the "current" row; once a resync has
    // succeeded, subsequent calls return the post-resync row.
    if (
      getInstallationByAccountLoginCallCount > 1 &&
      mockInstallationRowAfterResync !== undefined
    ) {
      return mockInstallationRowAfterResync;
    }
    return mockInstallationRow;
  },
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async (_userId: string) => mockUserToken,
}));

mock.module("@/lib/github/users", () => ({
  getGitHubUsername: async (_userId: string) => mockUsername,
}));

mock.module("@/lib/github/sync", () => ({
  syncUserInstallations: async (
    userId: string,
    userToken: string,
    personalAccountLogin: string,
  ) => {
    syncUserInstallationsCallCount += 1;
    return mockSyncUserInstallations(userId, userToken, personalAccountLogin);
  },
}));

mock.module("./app", () => ({
  withScopedInstallationOctokit: async (params: {
    installationId: number;
    repositoryId: number;
    permissions: Record<string, string>;
    operation: (octokit: {
      rest: { repos: { get: (_args: unknown) => Promise<unknown> } };
    }) => Promise<unknown>;
  }) => {
    if (mockScopedOctokitShouldFail) {
      const err = Object.assign(new Error("App repo access error"), {
        status: mockScopedOctokitFailStatus,
      });
      throw err;
    }
    // Simulate a minimal installation octokit that can call repos.get
    const installationOctokit = {
      rest: {
        repos: {
          get: async (_args: unknown) => ({ data: {} }),
        },
      },
    };
    return params.operation(installationOctokit);
  },
}));

// ── Import the module under test (after mocks) ────────────────────────────────

const { verifyRepoAccess } = await import("./access");

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeWriteOctokit() {
  return {
    rest: {
      repos: {
        get: async (_args: unknown) => ({
          data: {
            id: 99,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: true,
              pull: true,
            },
          },
        }),
      },
    },
  };
}

function makeReadOnlyOctokit() {
  return {
    rest: {
      repos: {
        get: async (_args: unknown) => ({
          data: {
            id: 99,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: false,
              pull: true,
            },
          },
        }),
      },
    },
  };
}

function resetToDefaults() {
  mockUserOctokit = makeWriteOctokit();
  mockInstallationRow = { installationId: 42 };
  mockScopedOctokitShouldFail = false;
  mockScopedOctokitFailStatus = 404;
  mockUserToken = "user-token";
  mockUsername = "octocat";
  mockSyncUserInstallations = async () => 0;
  mockInstallationRowAfterResync = undefined;
  syncUserInstallationsCallCount = 0;
  getInstallationByAccountLoginCallCount = 0;
}

beforeEach(resetToDefaults);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifyRepoAccess — userPermission resolution", () => {
  test("write-capable user (push:true) + valid installation + requiredUserPermission 'read' → ok:true with userPermission:'write'", async () => {
    mockUserOctokit = makeWriteOctokit();

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userPermission).toBe("write");
      expect(result.installationId).toBe(42);
      expect(result.repositoryId).toBe(99);
      expect(result.defaultBranch).toBe("main");
    }
  });

  test("admin-only user (admin:true, push:false) → userPermission:'write'", async () => {
    mockUserOctokit = {
      rest: {
        repos: {
          get: async (_args: unknown) => ({
            data: {
              id: 99,
              default_branch: "main",
              permissions: {
                admin: true,
                maintain: false,
                push: false,
                pull: true,
              },
            },
          }),
        },
      },
    };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userPermission).toBe("write");
    }
  });

  test("read-only user (push:false, maintain:false, admin:false) + requiredUserPermission 'read' → ok:true with userPermission:'read'", async () => {
    mockUserOctokit = makeReadOnlyOctokit();

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userPermission).toBe("read");
      expect(result.installationId).toBe(42);
    }
  });

  test("read-only user + requiredUserPermission 'write' → ok:false with reason:'user_no_write'", async () => {
    mockUserOctokit = makeReadOnlyOctokit();

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "write",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("user_no_write");
    }
  });
});

describe("verifyRepoAccess — denial paths", () => {
  test("missing user token (getUserOctokit returns null) → ok:false reason:'no_user_token'", async () => {
    mockUserOctokit = null;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_user_token");
    }
  });

  test("user octokit.repos.get returns 404 → ok:false reason:'user_no_access'", async () => {
    mockUserOctokit = {
      rest: {
        repos: {
          get: async (_args: unknown) => {
            const err = Object.assign(new Error("Not Found"), { status: 404 });
            throw err;
          },
        },
      },
    };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("user_no_access");
    }
  });

  test("user octokit.repos.get returns 403 → ok:false reason:'user_no_access'", async () => {
    mockUserOctokit = {
      rest: {
        repos: {
          get: async (_args: unknown) => {
            const err = Object.assign(new Error("Forbidden"), { status: 403 });
            throw err;
          },
        },
      },
    };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("user_no_access");
    }
  });

  test("no installation found → ok:false reason:'no_installation'", async () => {
    mockInstallationRow = undefined;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_installation");
    }
  });

  test("installation-scoped octokit check throws 404 → ok:false reason:'app_no_access'", async () => {
    mockScopedOctokitShouldFail = true;
    mockScopedOctokitFailStatus = 404;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("app_no_access");
    }
  });

  test("installation-scoped octokit check throws 403 → ok:false reason:'app_no_access'", async () => {
    mockScopedOctokitShouldFail = true;
    mockScopedOctokitFailStatus = 403;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("app_no_access");
    }
  });
});

describe("verifyRepoAccess — installation resync (#791)", () => {
  test("installation missing, resync finds it, proceeds to app-access check", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = { installationId: 77 };
    mockSyncUserInstallations = async () => 1;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installationId).toBe(77);
    }
  });

  test("installation missing, resync also finds nothing, returns typed still-missing result", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = undefined;
    mockSyncUserInstallations = async () => 0;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_installation");
    }
  });

  test("installation missing, resync throws, returns typed still-missing result without throwing", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = undefined;
    mockSyncUserInstallations = async () => {
      throw new Error("network error");
    };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_installation");
    }
  });

  test("installation missing, no user token available for resync, skips resync and returns no_installation", async () => {
    mockInstallationRow = undefined;
    mockUserToken = null;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_installation");
    }
  });

  test("installation missing, no GitHub username available for resync, skips resync and returns no_installation", async () => {
    mockInstallationRow = undefined;
    mockUsername = null;

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_installation");
    }
  });

  test("installation present on first read never triggers a resync call", async () => {
    mockInstallationRow = { installationId: 42 };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(syncUserInstallationsCallCount).toBe(0);
    expect(result.ok).toBe(true);
  });
});
