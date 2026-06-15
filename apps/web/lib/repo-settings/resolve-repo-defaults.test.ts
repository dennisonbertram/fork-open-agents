/**
 * Unit tests for resolveRepoDefaults / mergeRepoDefaults — BT-001 through BT-006
 *
 * All tests are PURE (no I/O): DB access modules are mocked so only the
 * precedence logic (system < user_preferences < repository_settings) is tested.
 *
 * null in repository_settings means "inherit from layer below" (null = inherit).
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ─── module mocks ─────────────────────────────────────────────────────────────
// These mocks shadow the DB helpers the resolver imports.

const mockGetUserPreferences = mock(async (_userId: string) => ({
  autoCommitPush: false,
  autoCreatePr: false,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
}));

const mockGetRepositorySettings = mock(
  async (_params: {
    userId: string;
    repoOwner: string;
    repoName: string;
  }) => undefined as
    | {
        fullClone: boolean | null;
        prewarmEnabled: boolean | null;
        runtimeMode: "classic" | "managed_runtime" | null;
        managedRuntimeProfileId: string | null;
        vcpus: number | null;
        autoCommitPush: boolean | null;
        autoCreatePr: boolean | null;
        defaultBranch: string | null;
        isNewBranch: boolean | null;
      }
    | undefined,
);

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: mockGetUserPreferences,
}));

mock.module("@/lib/db/repository-settings", () => ({
  getRepositorySettings: mockGetRepositorySettings,
}));

// ─── import after mocking ────────────────────────────────────────────────────
const { mergeRepoDefaults, resolveRepoDefaults } = await import(
  "./resolve-repo-defaults"
);

// ─── helpers ─────────────────────────────────────────────────────────────────

type NullableRepoSettings = {
  fullClone: boolean | null;
  prewarmEnabled: boolean | null;
  runtimeMode: "classic" | "managed_runtime" | null;
  managedRuntimeProfileId: string | null;
  vcpus: number | null;
  autoCommitPush: boolean | null;
  autoCreatePr: boolean | null;
  defaultBranch: string | null;
  isNewBranch: boolean | null;
};

function makeRepoSettings(
  overrides: Partial<NullableRepoSettings> = {},
): NullableRepoSettings {
  return {
    fullClone: null,
    prewarmEnabled: null,
    runtimeMode: null,
    managedRuntimeProfileId: null,
    vcpus: null,
    autoCommitPush: null,
    autoCreatePr: null,
    defaultBranch: null,
    isNewBranch: null,
    ...overrides,
  };
}

// ─── BT-001: All layers null/empty → system defaults ─────────────────────────

describe("mergeRepoDefaults — BT-001: all layers empty/null → system defaults", () => {
  it("BT-001: returns system default for autoCommitPush (false)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.autoCommitPush).toBe(false);
  });

  it("BT-001b: returns system default for runtimeMode (classic)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.runtimeMode).toBe("classic");
  });

  it("BT-001c: returns system default for managedRuntimeProfileId", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.managedRuntimeProfileId).toBe("web-bun-agent-browser");
  });

  it("BT-001d: returns system default for vcpus", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    // vcpus comes from DEFAULT_SANDBOX_VCPUS constant
    expect(typeof result.vcpus).toBe("number");
    expect(result.vcpus).toBeGreaterThan(0);
  });

  it("BT-001e: returns system default for fullClone (false)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.fullClone).toBe(false);
  });

  it("BT-001f: returns system default for prewarmEnabled (false)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.prewarmEnabled).toBe(false);
  });

  it("BT-001g: returns system default for isNewBranch (false)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.isNewBranch).toBe(false);
  });

  it("BT-001h: returns system default for defaultBranch (null)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.defaultBranch).toBeNull();
  });

  it("BT-001i: returns system default for autoCreatePr (false)", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.autoCreatePr).toBe(false);
  });
});

// ─── BT-002: user_preferences layer wins over system for fields it covers ────

describe("mergeRepoDefaults — BT-002: user_preferences layer wins", () => {
  it("BT-002a: user autoCommitPush=true wins over system false, repo null", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.autoCommitPush).toBe(true);
  });

  it("BT-002b: user autoCreatePr=true wins over system false, repo null", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: true, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.autoCreatePr).toBe(true);
  });

  it("BT-002c: user defaultManagedRuntimeProfileId wins over system, repo null", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "custom-profile" },
      makeRepoSettings(),
    );
    expect(result.managedRuntimeProfileId).toBe("custom-profile");
  });

  it("BT-002d: fields without user_preferences column still use system (runtimeMode)", () => {
    // runtimeMode has no user_preferences column, so system default is used
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.runtimeMode).toBe("classic");
  });
});

// ─── BT-003: repository_settings layer wins over both lower layers ─────────

describe("mergeRepoDefaults — BT-003: repository_settings wins over all", () => {
  it("BT-003a: repo autoCommitPush=true wins over user false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ autoCommitPush: true }),
    );
    expect(result.autoCommitPush).toBe(true);
  });

  it("BT-003b: repo runtimeMode=managed_runtime wins over system classic", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ runtimeMode: "managed_runtime" }),
    );
    expect(result.runtimeMode).toBe("managed_runtime");
  });

  it("BT-003c: repo managedRuntimeProfileId wins over user-pref value", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "user-profile" },
      makeRepoSettings({ managedRuntimeProfileId: "repo-specific-profile" }),
    );
    expect(result.managedRuntimeProfileId).toBe("repo-specific-profile");
  });

  it("BT-003d: repo vcpus wins over system default", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ vcpus: 8 }),
    );
    expect(result.vcpus).toBe(8);
  });

  it("BT-003e: repo fullClone=true wins over system false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ fullClone: true }),
    );
    expect(result.fullClone).toBe(true);
  });

  it("BT-003f: repo prewarmEnabled=true wins over system false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ prewarmEnabled: true }),
    );
    expect(result.prewarmEnabled).toBe(true);
  });

  it("BT-003g: repo defaultBranch wins over system null", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ defaultBranch: "main" }),
    );
    expect(result.defaultBranch).toBe("main");
  });

  it("BT-003h: repo isNewBranch=true wins over system false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ isNewBranch: true }),
    );
    expect(result.isNewBranch).toBe(true);
  });

  it("BT-003i: repo autoCreatePr=true wins over user false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ autoCreatePr: true }),
    );
    // autoCommitPush resolves true, so autoCreatePr is allowed to be true
    expect(result.autoCreatePr).toBe(true);
  });
});

// ─── BT-004: Partial repo override — only some fields set ────────────────────

describe("mergeRepoDefaults — BT-004: partial repo override", () => {
  it("BT-004: repo sets vcpus+fullClone; other fields inherit from user/system", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: false, defaultManagedRuntimeProfileId: "custom-profile" },
      makeRepoSettings({ vcpus: 2, fullClone: true }),
    );
    // repo fields
    expect(result.vcpus).toBe(2);
    expect(result.fullClone).toBe(true);
    // user_preferences fields
    expect(result.autoCommitPush).toBe(true);
    expect(result.managedRuntimeProfileId).toBe("custom-profile");
    // system fields (no user_preferences column for runtimeMode)
    expect(result.runtimeMode).toBe("classic");
  });
});

// ─── BT-005: Cross-field rule — autoCreatePr forced false when autoCommitPush false

describe("mergeRepoDefaults — BT-005: autoCreatePr forced false when autoCommitPush resolves false", () => {
  it("BT-005a: autoCommitPush resolves false (system) + repo/user autoCreatePr=true → autoCreatePr=false", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: true, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ autoCreatePr: true }),
    );
    expect(result.autoCommitPush).toBe(false);
    expect(result.autoCreatePr).toBe(false);
  });

  it("BT-005b: autoCommitPush resolves true → autoCreatePr can be true", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: true, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings(),
    );
    expect(result.autoCommitPush).toBe(true);
    expect(result.autoCreatePr).toBe(true);
  });

  it("BT-005c: repo autoCommitPush=false overrides user true → autoCreatePr forced false too", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: true, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ autoCommitPush: false, autoCreatePr: true }),
    );
    expect(result.autoCommitPush).toBe(false);
    expect(result.autoCreatePr).toBe(false);
  });
});

// ─── BT-006: null=inherit contract ────────────────────────────────────────────
// null in repo layer means "inherit from below", NOT "set to null/false"

describe("mergeRepoDefaults — BT-006: null=inherit contract", () => {
  it("BT-006a: repo null + user autoCommitPush=true → resolved true (null means inherit)", () => {
    // Core null=inherit contract: repo explicitly null does not override user layer
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: false, defaultManagedRuntimeProfileId: "web-bun-agent-browser" },
      makeRepoSettings({ autoCommitPush: null }), // explicitly null = inherit
    );
    expect(result.autoCommitPush).toBe(true);
  });

  it("BT-006b: repo null + user managedRuntimeProfileId → user value preserved", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: false, autoCreatePr: false, defaultManagedRuntimeProfileId: "user-profile" },
      makeRepoSettings({ managedRuntimeProfileId: null }),
    );
    expect(result.managedRuntimeProfileId).toBe("user-profile");
  });

  it("BT-006c: repo null for every field → all system/user defaults win", () => {
    const result = mergeRepoDefaults(
      { autoCommitPush: true, autoCreatePr: false, defaultManagedRuntimeProfileId: "custom-profile" },
      makeRepoSettings(), // all null
    );
    expect(result.autoCommitPush).toBe(true);
    expect(result.managedRuntimeProfileId).toBe("custom-profile");
    expect(result.runtimeMode).toBe("classic");
    expect(result.fullClone).toBe(false);
  });
});

// ─── BT-007: resolveRepoDefaults async wrapper ───────────────────────────────

describe("resolveRepoDefaults — BT-007: async wrapper delegates to mergeRepoDefaults", () => {
  beforeEach(() => {
    mockGetUserPreferences.mockReset();
    mockGetRepositorySettings.mockReset();
    mockGetUserPreferences.mockResolvedValue({
      autoCommitPush: false,
      autoCreatePr: false,
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
    });
    mockGetRepositorySettings.mockResolvedValue(undefined);
  });

  it("BT-007a: when no repo settings row, returns system defaults", async () => {
    const result = await resolveRepoDefaults({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
    });
    expect(result.autoCommitPush).toBe(false);
    expect(result.runtimeMode).toBe("classic");
    expect(result.fullClone).toBe(false);
  });

  it("BT-007b: when repo settings row exists, repo values win", async () => {
    mockGetRepositorySettings.mockResolvedValue(
      makeRepoSettings({ autoCommitPush: true, runtimeMode: "managed_runtime", vcpus: 4 }),
    );

    const result = await resolveRepoDefaults({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
    });
    expect(result.autoCommitPush).toBe(true);
    expect(result.runtimeMode).toBe("managed_runtime");
    expect(result.vcpus).toBe(4);
  });

  it("BT-007c: passes correct userId/repoOwner/repoName to getRepositorySettings", async () => {
    await resolveRepoDefaults({
      userId: "user-42",
      repoOwner: "MyOrg",
      repoName: "MyRepo",
    });
    const call = mockGetRepositorySettings.mock.calls[0]?.[0] as {
      userId: string;
      repoOwner: string;
      repoName: string;
    };
    expect(call.userId).toBe("user-42");
    expect(call.repoOwner).toBe("MyOrg");
    expect(call.repoName).toBe("MyRepo");
  });
});
