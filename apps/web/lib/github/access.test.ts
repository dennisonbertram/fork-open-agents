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
let mockScopedOctokitFailMessage = "App repo access error";
let mockServiceRepoGrant: { repositoryId: number } | null = null;

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

mock.module("@/lib/db/service-identities", () => ({
  getGitHubAppServiceRepoGrant: async (
    _userId: string,
    _owner: string,
    _repo: string,
  ) => mockServiceRepoGrant,
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
      const err = Object.assign(new Error(mockScopedOctokitFailMessage), {
        status: mockScopedOctokitFailStatus,
      });
      throw err;
    }
    // Simulate a minimal installation octokit that can call repos.get
    const installationOctokit = {
      rest: {
        repos: {
          get: async (_args: unknown) => ({
            data: { id: 99, default_branch: "main" },
          }),
        },
      },
    };
    return params.operation(installationOctokit);
  },
}));

// ── Import the module under test (after mocks) ────────────────────────────────

const {
  getRepoAccessErrorMessage,
  getRepoAccessErrorStatus,
  verifyRepoAccess,
} = await import("./access");

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
  mockScopedOctokitFailMessage = "App repo access error";
  mockServiceRepoGrant = null;
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

describe("verifyRepoAccess — installation-scoped service identity", () => {
  test("permits an exact-repo service grant for read access", async () => {
    mockUserOctokit = null;
    mockServiceRepoGrant = { repositoryId: 99 };

    const result = await verifyRepoAccess({
      userId: "service-user",
      owner: "acme",
      repo: "disposable-proof",
      requiredUserPermission: "read",
    });

    expect(result).toEqual({
      ok: true,
      installationId: 42,
      repositoryId: 99,
      defaultBranch: "main",
      userPermission: "read",
    });
  });

  test("never promotes an installation-scoped service identity to write", async () => {
    mockUserOctokit = null;
    mockServiceRepoGrant = { repositoryId: 99 };

    const result = await verifyRepoAccess({
      userId: "service-user",
      owner: "acme",
      repo: "disposable-proof",
      requiredUserPermission: "write",
    });

    expect(result).toEqual({ ok: false, reason: "user_no_write" });
  });

  test("keeps missing-token denial without an exact service grant", async () => {
    mockUserOctokit = null;
    mockServiceRepoGrant = null;

    const result = await verifyRepoAccess({
      userId: "service-user",
      owner: "acme",
      repo: "other-repo",
      requiredUserPermission: "read",
    });

    expect(result).toEqual({ ok: false, reason: "no_user_token" });
  });
});

// ── Regression: rejected credentials must not throw (issue #1056) ─────────────

function makeThrowingOctokit(error: unknown) {
  return {
    rest: {
      repos: {
        get: async (_args: unknown) => {
          throw error;
        },
      },
    },
  };
}

describe("verifyRepoAccess — credential and rate-limit errors", () => {
  test("401 Bad credentials → ok:false reason 'user_token_rejected' (not thrown)", async () => {
    mockUserOctokit = makeThrowingOctokit(
      Object.assign(new Error("Bad credentials"), { status: 401 }),
    );

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result).toEqual({ ok: false, reason: "user_token_rejected" });
  });

  test("403 rate limit → ok:false reason 'rate_limited' (never asks to reconnect)", async () => {
    mockUserOctokit = makeThrowingOctokit(
      Object.assign(new Error("API rate limit exceeded for user"), {
        status: 403,
      }),
    );

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(getRepoAccessErrorMessage("rate_limited")).not.toMatch(/reconnect/i);
  });

  test("plain 403 permission denial still maps to user_no_access", async () => {
    mockUserOctokit = makeThrowingOctokit(
      Object.assign(new Error("Resource not accessible by integration"), {
        status: 403,
      }),
    );

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result).toEqual({ ok: false, reason: "user_no_access" });
  });

  test("genuine server fault (500) still throws", async () => {
    mockUserOctokit = makeThrowingOctokit(
      Object.assign(new Error("boom"), { status: 500 }),
    );

    expect(
      verifyRepoAccess({ userId: "user-1", owner: "acme", repo: "my-repo" }),
    ).rejects.toThrow("boom");
  });

  test("installation-scoped 403 rate limit → ok:false reason 'rate_limited'", async () => {
    mockScopedOctokitShouldFail = true;
    mockScopedOctokitFailStatus = 403;
    mockScopedOctokitFailMessage = "You have exceeded a secondary rate limit";

    const result = await verifyRepoAccess({
      userId: "user-1",
      owner: "acme",
      repo: "my-repo",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  test("installation-scoped 401 is an app credential fault and still throws", async () => {
    mockScopedOctokitShouldFail = true;
    mockScopedOctokitFailStatus = 401;

    expect(
      verifyRepoAccess({ userId: "user-1", owner: "acme", repo: "my-repo" }),
    ).rejects.toThrow();
  });

  test("HTTP status maps to 401 for rejection, 429 for rate limit, 403 otherwise", () => {
    expect(getRepoAccessErrorStatus("user_token_rejected")).toBe(401);
    expect(getRepoAccessErrorStatus("no_user_token")).toBe(401);
    expect(getRepoAccessErrorStatus("rate_limited")).toBe(429);
    expect(getRepoAccessErrorStatus("user_no_access")).toBe(403);
  });
});
