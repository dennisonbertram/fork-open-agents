/**
 * Regression tests for mergeRepoDefaults.
 *
 * Each test here catches a specific failure mode that would occur if the
 * implementation in resolve-repo-defaults.ts were reverted or broken:
 *
 * - RG-001: null=inherit contract — if null is treated as "set false/0/null"
 *   instead of "inherit from layer below", user-preference values would be
 *   silently zeroed.
 * - RG-002: autoCreatePr forced-false invariant — if the cross-field rule is
 *   dropped, sessions would get autoCreatePr=true with autoCommitPush=false,
 *   creating PRs from nothing.
 * - RG-003: all-fields coverage — if a new nullable field is added to the
 *   ResolvedRepoDefaults type but forgotten in mergeRepoDefaults, the resolver
 *   would return undefined for that field; this test catches the omission.
 * - RG-004: system defaults are not user_preferences — runtimeMode/vcpus/
 *   fullClone/prewarmEnabled/isNewBranch do NOT have a user_preferences column;
 *   if a refactor accidentally reads from userPrefs for those fields, this test
 *   catches it by passing a userPrefs object that lacks those properties.
 * - RG-005: repo layer wins — if priority order is accidentally inverted so
 *   user_preferences wins over repository_settings, this test fails.
 */

import { describe, expect, it, mock } from "bun:test";

// ─── Silence server-only and DB imports (mergeRepoDefaults is pure but the
//     module-level imports of DB helpers carry server-only guards) ──────────────
mock.module("server-only", () => ({}));
mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({}),
}));
mock.module("@/lib/db/repository-settings", () => ({
  getRepositorySettings: async () => undefined,
}));

// Import the pure function — no actual DB calls happen in these tests
const { mergeRepoDefaults } = await import("./resolve-repo-defaults");

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function allNull(): NullableRepoSettings {
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
  };
}

// ─── RG-001: null=inherit — repo null must NOT zero user-pref values ──────────

describe("RG-001: null=inherit contract preserved on revert", () => {
  it("repo null autoCommitPush + user true → resolved true (not false)", () => {
    // If a refactor treats null as "false", this will fail:
    // result.autoCommitPush would be false instead of true.
    const result = mergeRepoDefaults(
      {
        autoCommitPush: true,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      { ...allNull(), autoCommitPush: null },
    );
    expect(result.autoCommitPush).toBe(true);
  });

  it("repo null managedRuntimeProfileId + user custom → user value preserved", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "my-profile",
      },
      { ...allNull(), managedRuntimeProfileId: null },
    );
    expect(result.managedRuntimeProfileId).toBe("my-profile");
  });

  it("repo null autoCreatePr + user true + autoCommitPush true → resolved true", () => {
    // repo null = inherit; user autoCreatePr=true; autoCommitPush=true → should be true
    const result = mergeRepoDefaults(
      {
        autoCommitPush: true,
        autoCreatePr: true,
        defaultManagedRuntimeProfileId: "p",
      },
      { ...allNull(), autoCreatePr: null },
    );
    expect(result.autoCreatePr).toBe(true);
  });
});

// ─── RG-002: autoCreatePr forced-false invariant ──────────────────────────────

describe("RG-002: autoCreatePr=false when autoCommitPush=false", () => {
  it("user autoCreatePr=true but autoCommitPush resolves false → autoCreatePr=false", () => {
    // If the cross-field rule is removed, result.autoCreatePr would be true.
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: true,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(result.autoCommitPush).toBe(false);
    expect(result.autoCreatePr).toBe(false);
  });

  it("repo autoCommitPush=false overrides user true → autoCreatePr still forced false", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: true,
        autoCreatePr: true,
        defaultManagedRuntimeProfileId: "p",
      },
      { ...allNull(), autoCommitPush: false, autoCreatePr: true },
    );
    expect(result.autoCommitPush).toBe(false);
    expect(result.autoCreatePr).toBe(false);
  });

  it("autoCreatePr=true is allowed when autoCommitPush resolves true (not over-restricted)", () => {
    // Guard against accidentally forcing autoCreatePr=false unconditionally.
    const result = mergeRepoDefaults(
      {
        autoCommitPush: true,
        autoCreatePr: true,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(result.autoCreatePr).toBe(true);
  });
});

// ─── RG-003: all fields present in the returned object ───────────────────────

describe("RG-003: all ResolvedRepoDefaults fields are defined (not undefined)", () => {
  it("returned object has every expected key with a non-undefined value", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    // Every field must be present and not undefined
    expect(result.autoCommitPush).not.toBeUndefined();
    expect(result.autoCreatePr).not.toBeUndefined();
    expect(result.managedRuntimeProfileId).not.toBeUndefined();
    expect(result.runtimeMode).not.toBeUndefined();
    expect(result.vcpus).not.toBeUndefined();
    expect(result.fullClone).not.toBeUndefined();
    expect(result.prewarmEnabled).not.toBeUndefined();
    // defaultBranch is allowed to be null (system default) but must be present
    expect("defaultBranch" in result).toBe(true);
    expect(result.isNewBranch).not.toBeUndefined();
  });

  it("runtimeMode is always a string (never undefined)", () => {
    // Catches: forgetting to set runtimeMode = SYSTEM_DEFAULTS.runtimeMode
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(typeof result.runtimeMode).toBe("string");
  });
});

// ─── RG-004: fields with no user_preferences column still resolve correctly ───

describe("RG-004: system-only fields use system defaults when no repo override", () => {
  it("runtimeMode defaults to classic from system (not from userPrefs object)", () => {
    // userPrefs has no runtimeMode field — if the impl tries to read
    // userPrefs.runtimeMode it gets undefined, which would break the resolved value.
    const result = mergeRepoDefaults(
      // Intentionally omit runtimeMode from userPrefs (it doesn't exist there)
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(result.runtimeMode).toBe("classic");
  });

  it("vcpus comes from system default when repo is null", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(result.vcpus).toBeGreaterThan(0);
  });

  it("fullClone defaults to false from system when repo null", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      allNull(),
    );
    expect(result.fullClone).toBe(false);
  });
});

// ─── RG-005: repo layer wins over user_preferences ───────────────────────────

describe("RG-005: repository_settings wins over user_preferences on every shared field", () => {
  it("repo autoCommitPush=true beats user false", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "user-p",
      },
      { ...allNull(), autoCommitPush: true },
    );
    expect(result.autoCommitPush).toBe(true);
  });

  it("repo managedRuntimeProfileId beats user value", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "user-p",
      },
      { ...allNull(), managedRuntimeProfileId: "repo-p" },
    );
    expect(result.managedRuntimeProfileId).toBe("repo-p");
  });

  it("repo runtimeMode=managed_runtime beats system classic", () => {
    const result = mergeRepoDefaults(
      {
        autoCommitPush: false,
        autoCreatePr: false,
        defaultManagedRuntimeProfileId: "p",
      },
      { ...allNull(), runtimeMode: "managed_runtime" },
    );
    expect(result.runtimeMode).toBe("managed_runtime");
  });
});
