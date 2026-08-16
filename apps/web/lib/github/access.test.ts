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
  __resetInstallationResyncCooldownForTests,
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
  mockUserToken = "user-token";
  mockUsername = "octocat";
  mockSyncUserInstallations = async () => 0;
  mockInstallationRowAfterResync = undefined;
  syncUserInstallationsCallCount = 0;
  getInstallationByAccountLoginCallCount = 0;
  // The resync cooldown is module-level state. Without clearing it the first
  // test to trigger a resync suppresses every later one in this file.
  __resetInstallationResyncCooldownForTests();
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

describe("verifyRepoAccess — resync review findings (#791 follow-up)", () => {
  // Finding 1. Two concurrent checks on a newly installed owner can both call
  // syncUserInstallations; its select-then-insert upsert means one loses the
  // unique-index race. The old code only re-read when the attempt "succeeded",
  // so the loser reported no_installation even though the row now existed.
  test("re-reads the installation even when the sync itself throws", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = { installationId: 77 };
    mockSyncUserInstallations = async () => {
      throw new Error("duplicate key value violates unique constraint");
    };

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "acme",
      repo: "widgets",
    });

    expect(getInstallationByAccountLoginCallCount).toBe(2);
    expect(result.ok).toBe(true);
  });

  // Finding 2. A user browsing a public repo they never installed the App on
  // hits this branch on every call, across 23+ call sites. Each attempt
  // paginates every installation.
  test("does not resync twice for the same user inside the cooldown", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = undefined;

    await verifyRepoAccess({ userId: "u1", owner: "acme", repo: "widgets" });
    await verifyRepoAccess({ userId: "u1", owner: "acme", repo: "widgets" });

    expect(syncUserInstallationsCallCount).toBe(1);
  });

  test("the cooldown is per user, not global", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = undefined;

    await verifyRepoAccess({ userId: "u1", owner: "acme", repo: "widgets" });
    await verifyRepoAccess({ userId: "u2", owner: "acme", repo: "widgets" });

    expect(syncUserInstallationsCallCount).toBe(2);
  });

  // Finding 3. The catch used to erase the failure entirely, so the user was
  // told to install the App and operators saw nothing.
  test("records a structured event when the sync fails", async () => {
    mockInstallationRow = undefined;
    mockInstallationRowAfterResync = undefined;
    mockSyncUserInstallations = async () => {
      throw new Error("github 500");
    };
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const result = await verifyRepoAccess({
        userId: "u1",
        owner: "acme",
        repo: "widgets",
      });
      expect(result).toEqual({ ok: false, reason: "no_installation" });
    } finally {
      console.warn = original;
    }

    const event = warnings.find(
      (args) =>
        (args[1] as { eventName?: string } | undefined)?.eventName ===
        "github.access.installation_resync_failed",
    );
    expect(event).toBeDefined();
    expect(event?.[1]).toMatchObject({ userId: "u1", owner: "acme" });
  });

  // The regression guard that matters most: the success path is the gate for
  // 23+ call sites and must never pay for any of this.
  test("a successful first read never triggers a resync", async () => {
    mockInstallationRow = { installationId: 42 };

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "acme",
      repo: "widgets",
    });

    expect(result.ok).toBe(true);
    expect(syncUserInstallationsCallCount).toBe(0);
    expect(getInstallationByAccountLoginCallCount).toBe(1);
  });
});
