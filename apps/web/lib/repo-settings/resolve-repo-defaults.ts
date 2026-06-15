/**
 * Per-repo session defaults resolver.
 *
 * Implements a three-layer precedence for session-creation defaults:
 *
 *   system default < user_preferences < repository_settings
 *
 * A null value in repository_settings means "inherit from layer below"
 * (null = inherit, not null = clear/override).
 *
 * Fields without a user_preferences column have a two-layer precedence
 * (system < repo) until a future phase adds them to user_preferences.
 * The signature still accepts the userPrefs object so adding those layers
 * later is non-breaking.
 *
 * Follows the pure-resolver convention from lib/agents/resolve-agent.ts:
 * - mergeRepoDefaults() is a pure function testable without any DB access.
 * - resolveRepoDefaults() is the async wrapper that fetches DB state.
 */

import { getUserPreferences } from "@/lib/db/user-preferences";
import { getRepositorySettings } from "@/lib/db/repository-settings";
import {
  DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { DEFAULT_SANDBOX_VCPUS } from "@/lib/sandbox/config";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The minimal slice of UserPreferencesData that the resolver consumes.
 * Typed narrowly so tests can pass plain objects without importing the full type.
 */
export interface UserPrefsSlice {
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  defaultManagedRuntimeProfileId: string;
}

/**
 * The minimal shape of a repository_settings row that the resolver consumes.
 * All fields are nullable (null = inherit from the layer below).
 */
export interface RepoSettingsSlice {
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

/**
 * Fully resolved per-repo session defaults, ready for session creation.
 * Every field is non-nullable — the resolver collapses the three layers
 * into concrete values before returning.
 */
export interface ResolvedRepoDefaults {
  /** Whether to auto-commit and push after agent changes. */
  autoCommitPush: boolean;
  /**
   * Whether to auto-create a PR after committing.
   * Invariant: always false when autoCommitPush is false.
   */
  autoCreatePr: boolean;
  /** The managed-runtime profile ID to use for this session. */
  managedRuntimeProfileId: string;
  /** The runtime execution mode for this session. */
  runtimeMode: "classic" | "managed_runtime";
  /** Number of vCPUs to allocate to the sandbox. */
  vcpus: number;
  /** Whether to perform a full git clone (vs shallow). */
  fullClone: boolean;
  /** Whether to prewarm the sandbox environment. */
  prewarmEnabled: boolean;
  /** The default branch for the repo, or null when not pinned. */
  defaultBranch: string | null;
  /** Whether the session should target a new branch. */
  isNewBranch: boolean;
}

// ── System defaults ────────────────────────────────────────────────────────────

const SYSTEM_DEFAULTS = {
  autoCommitPush: false,
  autoCreatePr: false,
  managedRuntimeProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
  runtimeMode: "classic" as const,
  vcpus: DEFAULT_SANDBOX_VCPUS,
  fullClone: false,
  prewarmEnabled: false,
  defaultBranch: null as string | null,
  isNewBranch: false,
};

// ── Pure resolver ──────────────────────────────────────────────────────────────

/**
 * Pure function — merges already-fetched plain objects into a ResolvedRepoDefaults.
 *
 * Precedence per field (most specific wins; null at repo layer = inherit):
 *   system < user_preferences < repository_settings
 *
 * Fields that have no user_preferences column (runtimeMode, vcpus, fullClone,
 * prewarmEnabled, defaultBranch, isNewBranch) follow a two-layer precedence:
 *   system < repository_settings
 *
 * Cross-field invariant: autoCreatePr is forced false when autoCommitPush
 * resolves false, preserving the rule in sessions/route.ts.
 */
export function mergeRepoDefaults(
  userPrefs: UserPrefsSlice,
  repoSettings: RepoSettingsSlice | null | undefined,
): ResolvedRepoDefaults {
  // Layer 1: system defaults (lowest priority)
  // Layer 2: user_preferences (for fields that exist there)
  // Layer 3: repository_settings (highest priority, null = skip/inherit)

  const autoCommitPush =
    repoSettings?.autoCommitPush != null
      ? repoSettings.autoCommitPush
      : userPrefs.autoCommitPush;

  const autoCreatePrBeforeRule =
    repoSettings?.autoCreatePr != null
      ? repoSettings.autoCreatePr
      : userPrefs.autoCreatePr;

  // Cross-field invariant: autoCreatePr cannot be true when autoCommitPush is false
  const autoCreatePr = autoCommitPush ? autoCreatePrBeforeRule : false;

  const managedRuntimeProfileId =
    repoSettings?.managedRuntimeProfileId != null
      ? repoSettings.managedRuntimeProfileId
      : userPrefs.defaultManagedRuntimeProfileId;

  // Fields with no user_preferences column: system < repo
  const runtimeMode =
    repoSettings?.runtimeMode != null
      ? repoSettings.runtimeMode
      : SYSTEM_DEFAULTS.runtimeMode;

  const vcpus =
    repoSettings?.vcpus != null ? repoSettings.vcpus : SYSTEM_DEFAULTS.vcpus;

  const fullClone =
    repoSettings?.fullClone != null
      ? repoSettings.fullClone
      : SYSTEM_DEFAULTS.fullClone;

  const prewarmEnabled =
    repoSettings?.prewarmEnabled != null
      ? repoSettings.prewarmEnabled
      : SYSTEM_DEFAULTS.prewarmEnabled;

  const defaultBranch =
    repoSettings?.defaultBranch != null
      ? repoSettings.defaultBranch
      : SYSTEM_DEFAULTS.defaultBranch;

  const isNewBranch =
    repoSettings?.isNewBranch != null
      ? repoSettings.isNewBranch
      : SYSTEM_DEFAULTS.isNewBranch;

  return {
    autoCommitPush,
    autoCreatePr,
    managedRuntimeProfileId,
    runtimeMode,
    vcpus,
    fullClone,
    prewarmEnabled,
    defaultBranch,
    isNewBranch,
  };
}

// ── Async wrapper ──────────────────────────────────────────────────────────────

export interface ResolveRepoDefaultsParams {
  userId: string;
  repoOwner: string;
  repoName: string;
}

/**
 * Resolve the effective per-repo session defaults for a given user + repo.
 *
 * Fetches user_preferences and repository_settings in parallel, then
 * delegates to the pure mergeRepoDefaults function.
 */
export async function resolveRepoDefaults(
  params: ResolveRepoDefaultsParams,
): Promise<ResolvedRepoDefaults> {
  const { userId, repoOwner, repoName } = params;

  const [prefs, repoSettings] = await Promise.all([
    getUserPreferences(userId),
    getRepositorySettings({ userId, repoOwner, repoName }),
  ]);

  return mergeRepoDefaults(
    {
      autoCommitPush: prefs.autoCommitPush,
      autoCreatePr: prefs.autoCreatePr,
      defaultManagedRuntimeProfileId: prefs.defaultManagedRuntimeProfileId,
    },
    repoSettings ?? null,
  );
}
