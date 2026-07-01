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
let mockInstallationRow:
  | { installationId: number; repositorySelection: "all" | "selected" }
  | undefined = {
  installationId: 42,
  repositorySelection: "selected",
};

// Controls whether the installation-scoped octokit check succeeds or throws.
let mockScopedOctokitShouldFail = false;
let mockScopedOctokitFailStatus = 404;

// ── Module mocks ───────────────────────────────────────────────────────────────

mock.module("@/lib/github/client", () => ({
  getUserOctokit: async (_userId: string) => mockUserOctokit,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationByAccountLogin: async (
    _userId: string,
    _accountLogin: string,
  ) => mockInstallationRow,
}));

mock.module("./app", () => ({
  withScopedInstallationOctokit: async (params: {
    installationId: number;
    repositoryIds: number[];
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
  mockInstallationRow = { installationId: 42, repositorySelection: "selected" };
  mockScopedOctokitShouldFail = false;
  mockScopedOctokitFailStatus = 404;
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
      expect(result.repositorySelection).toBe("selected");
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

  test("installation with repositorySelection:'all' surfaces that on the ok result (needed by the all_repos runtime gate)", async () => {
    mockInstallationRow = { installationId: 42, repositorySelection: "all" };

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositorySelection).toBe("all");
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

describe("verifyRepoAccess — repositorySelection regression", () => {
  test("re-resolves repositorySelection on every call instead of caching a stale value (required for the A4 runtime write-scope gate)", async () => {
    mockInstallationRow = { installationId: 42, repositorySelection: "all" };

    const firstResult = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(firstResult.repositorySelection).toBe("all");
    }

    // Simulate the installer narrowing the installation's repo selection on
    // GitHub in between two runs of the same agent.
    mockInstallationRow = {
      installationId: 42,
      repositorySelection: "selected",
    };

    const secondResult = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
      requiredUserPermission: "read",
    });

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.repositorySelection).toBe("selected");
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
