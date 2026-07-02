import "server-only";

import {
  DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
  isManagedRuntimeProfileId,
  type ManagedRuntimeProfile,
  type ManagedRuntimeProfileCommand,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { and, desc, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { emitSessionEvent } from "@/lib/observability/events";
import { db } from "./client";
import {
  type ManagedRuntimeCommandObservation,
  type ManagedRuntimeProfileDraft,
  type ManagedRuntimeSavedProfile,
  managedRuntimeProfileDrafts,
  managedRuntimeSavedProfiles,
  sessions,
  userPreferences,
} from "./schema";

function normalizeCommand(
  command: ManagedRuntimeProfileCommand,
): ManagedRuntimeProfileCommand {
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    command: command.command,
    timeoutMs: command.timeoutMs,
    required: command.required,
  };
}

/**
 * Structured log for the account-level (no session context)
 * `managed_runtime.profile.preference_reset` event. `session_events` cannot
 * hold this event because `session_id` is a NOT NULL FK to `sessions.id`;
 * the API response's `preferenceReset: true` field is the durable evidence
 * surface consumed by callers (see #808 API contract).
 */
function emitManagedRuntimePreferenceResetLog(payload: {
  userId: string;
  deletedProfileId: string;
  newDefaultProfileId: string;
}): void {
  console.info(
    "[observability] managed_runtime.profile.preference_reset",
    payload,
  );
}

export function savedProfileIdForDraft(draftId: string): string {
  return `session-profile-${draftId}`;
}

export function toManagedRuntimeProfile(
  profile: ManagedRuntimeSavedProfile,
): ManagedRuntimeProfile {
  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    setupCommands: profile.setupCommands,
    verificationCommands: profile.verificationCommands,
    expectedTools: profile.expectedTools,
    optionalTools: profile.optionalTools,
    defaultPorts: profile.defaultPorts,
  };
}

export async function getManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  return db.query.managedRuntimeSavedProfiles.findFirst({
    where: and(
      eq(managedRuntimeSavedProfiles.id, params.profileId),
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
    ),
  });
}

/**
 * App-level validator for a managed-runtime profile id reference — the
 * write-path guard now that there is no (and can be no) foreign key on
 * profile id columns: built-in profile ids exist only in code
 * (packages/sandbox/managed-runtime-profiles.ts), so a DB FK is impossible.
 * Returns true when the id is a built-in profile, a session-scope saved
 * profile owned by this user+session, or a user_default-scope saved profile
 * owned by this user. Consumed by write-path routes (MR-4).
 */
export async function isKnownManagedRuntimeProfileReference(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<boolean> {
  if (isManagedRuntimeProfileId(params.profileId)) {
    return true;
  }

  const saved = await db.query.managedRuntimeSavedProfiles.findFirst({
    where: and(
      eq(managedRuntimeSavedProfiles.id, params.profileId),
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      or(
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
        eq(managedRuntimeSavedProfiles.scope, "user_default"),
      ),
    ),
  });

  return Boolean(saved);
}

export async function listManagedRuntimeSavedProfiles(params: {
  userId: string;
  sessionId: string;
}): Promise<ManagedRuntimeSavedProfile[]> {
  return db.query.managedRuntimeSavedProfiles.findMany({
    where: and(
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
    ),
    orderBy: [desc(managedRuntimeSavedProfiles.updatedAt)],
  });
}

export async function updateManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  profile: Pick<
    ManagedRuntimeProfile,
    | "displayName"
    | "description"
    | "setupCommands"
    | "verificationCommands"
    | "expectedTools"
    | "optionalTools"
    | "defaultPorts"
  >;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const now = new Date();
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      version: `edited-${now.toISOString()}`,
      displayName: params.profile.displayName,
      description: params.profile.description,
      setupCommands: params.profile.setupCommands.map(normalizeCommand),
      verificationCommands:
        params.profile.verificationCommands.map(normalizeCommand),
      expectedTools: params.profile.expectedTools,
      optionalTools: params.profile.optionalTools,
      defaultPorts: params.profile.defaultPorts,
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}

export type DeleteManagedRuntimeSavedProfileResult =
  ManagedRuntimeSavedProfile & {
    /** True when an active session referencing this profile was reset. */
    sessionsReset: boolean;
  };

/**
 * Deletes a session-scope saved profile. Per Decision D2, if the owning
 * session is currently pointed at the deleted profile, the session is reset
 * to runtimeMode "classic" (not just given a fallback profile id) so the
 * runtime never silently keeps running in managed_runtime against a profile
 * that no longer exists. Emits
 * `managed_runtime.profile.deleted_active_reset` after the transaction
 * commits (warn-and-continue: an event-emit failure must not roll back the
 * delete — Decision D8).
 */
export async function deleteManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  fallbackProfileId: string;
}): Promise<DeleteManagedRuntimeSavedProfileResult | undefined> {
  const result = await db.transaction(async (tx) => {
    const [profile] = await tx
      .delete(managedRuntimeSavedProfiles)
      .where(
        and(
          eq(managedRuntimeSavedProfiles.id, params.profileId),
          eq(managedRuntimeSavedProfiles.userId, params.userId),
          eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
        ),
      )
      .returning();

    if (!profile) {
      return undefined;
    }

    const [resetSession] = await tx
      .update(sessions)
      .set({
        runtimeMode: "classic",
        managedRuntimeProfileId: params.fallbackProfileId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sessions.id, params.sessionId),
          eq(sessions.userId, params.userId),
          eq(sessions.managedRuntimeProfileId, params.profileId),
        ),
      )
      .returning();

    return { profile, resetSession };
  });

  if (!result) {
    return undefined;
  }

  const sessionsReset = Boolean(result.resetSession);

  if (sessionsReset) {
    await emitSessionEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "user",
      eventName: "managed_runtime.profile.deleted_active_reset",
      status: "info",
      summary: `Session's managed runtime profile "${params.profileId}" was deleted; runtime mode reset to classic.`,
      payload: {
        sessionId: params.sessionId,
        profileId: params.profileId,
        previousRuntimeMode: "managed_runtime",
        newRuntimeMode: "classic",
        fallbackProfileId: params.fallbackProfileId,
      },
    });
  }

  return { ...result.profile, sessionsReset };
}

export async function applyDraftAsSessionManagedRuntimeProfile(params: {
  userId: string;
  sessionId: string;
  draft: ManagedRuntimeProfileDraft;
}): Promise<ManagedRuntimeSavedProfile> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const profileId = savedProfileIdForDraft(params.draft.id);
    const profileValues = {
      id: profileId,
      userId: params.userId,
      sessionId: params.sessionId,
      sourceDraftId: params.draft.id,
      scope: "session" as const,
      version: `draft-${params.draft.updatedAt.toISOString()}`,
      displayName: params.draft.profileDraft.displayName,
      description: params.draft.profileDraft.description,
      setupCommands:
        params.draft.profileDraft.setupCommands.map(normalizeCommand),
      verificationCommands:
        params.draft.profileDraft.verificationCommands.map(normalizeCommand),
      expectedTools: params.draft.profileDraft.expectedTools,
      optionalTools: params.draft.profileDraft.optionalTools,
      defaultPorts: params.draft.profileDraft.defaultPorts,
      latestTestRunId: params.draft.latestTestRunId,
      testResults: params.draft.testResults,
      testFailureMessage: params.draft.testFailureMessage,
      testedAt: params.draft.testedAt,
      updatedAt: now,
    };

    const [profile] = await tx
      .insert(managedRuntimeSavedProfiles)
      .values(profileValues)
      .onConflictDoUpdate({
        target: managedRuntimeSavedProfiles.id,
        set: {
          version: profileValues.version,
          displayName: profileValues.displayName,
          description: profileValues.description,
          setupCommands: profileValues.setupCommands,
          verificationCommands: profileValues.verificationCommands,
          expectedTools: profileValues.expectedTools,
          optionalTools: profileValues.optionalTools,
          defaultPorts: profileValues.defaultPorts,
          latestTestRunId: profileValues.latestTestRunId,
          testResults: profileValues.testResults,
          testFailureMessage: profileValues.testFailureMessage,
          testedAt: profileValues.testedAt,
          updatedAt: now,
        },
      })
      .returning();

    if (!profile) {
      throw new Error("Failed to save managed runtime profile");
    }

    await tx
      .update(sessions)
      .set({
        managedRuntimeProfileId: profile.id,
        runtimeMode: "managed_runtime",
        updatedAt: now,
      })
      .where(
        and(
          eq(sessions.id, params.sessionId),
          eq(sessions.userId, params.userId),
        ),
      );

    await tx
      .update(managedRuntimeProfileDrafts)
      .set({
        status: "applied",
        userDecision: "approved",
        updatedAt: now,
      })
      .where(
        and(
          eq(managedRuntimeProfileDrafts.id, params.draft.id),
          eq(managedRuntimeProfileDrafts.userId, params.userId),
          eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
        ),
      );

    return profile;
  });
}

export async function markManagedRuntimeSavedProfileTesting(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      latestTestRunId: nanoid(),
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}

// ---------------------------------------------------------------------------
// user_default scope helpers (account-level, not tied to a session)
// ---------------------------------------------------------------------------

export type CreateUserDefaultProfileParams = {
  userId: string;
  displayName: string;
  description: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
};

/**
 * Insert a new account-level managed runtime profile (scope=user_default,
 * session_id=null). Mirrors applyDraftAsSessionManagedRuntimeProfile's insert
 * logic but is parameterized for scope/sessionId instead of using a draft.
 */
export async function createManagedRuntimeSavedProfile(
  params: CreateUserDefaultProfileParams,
): Promise<ManagedRuntimeSavedProfile> {
  const now = new Date();
  const id = `user-profile-${nanoid()}`;
  const [profile] = await db
    .insert(managedRuntimeSavedProfiles)
    .values({
      id,
      userId: params.userId,
      sessionId: null,
      sourceDraftId: null,
      scope: "user_default",
      version: `created-${now.toISOString()}`,
      displayName: params.displayName,
      description: params.description,
      setupCommands: params.setupCommands.map(normalizeCommand),
      verificationCommands: params.verificationCommands.map(normalizeCommand),
      expectedTools: params.expectedTools,
      optionalTools: params.optionalTools,
      defaultPorts: params.defaultPorts,
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: now,
    })
    .returning();

  if (!profile) {
    throw new Error("Failed to create managed runtime profile");
  }

  return profile;
}

/**
 * List all account-level (scope=user_default) saved profiles for a user.
 */
export async function listUserDefaultProfiles(params: {
  userId: string;
}): Promise<ManagedRuntimeSavedProfile[]> {
  return db.query.managedRuntimeSavedProfiles.findMany({
    where: and(
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.scope, "user_default"),
    ),
    orderBy: [desc(managedRuntimeSavedProfiles.updatedAt)],
  });
}

/**
 * Get a single account-level profile by id + userId.
 * Returns undefined if not found or if it belongs to a different user.
 */
export async function getUserDefaultProfile(params: {
  userId: string;
  profileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  return db.query.managedRuntimeSavedProfiles.findFirst({
    where: and(
      eq(managedRuntimeSavedProfiles.id, params.profileId),
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.scope, "user_default"),
    ),
  });
}

/**
 * Update an account-level profile. Clears test evidence (same as the session
 * PATCH) since editing invalidates prior results.
 */
export async function updateUserDefaultProfile(params: {
  userId: string;
  profileId: string;
  profile: Pick<
    ManagedRuntimeProfile,
    | "displayName"
    | "description"
    | "setupCommands"
    | "verificationCommands"
    | "expectedTools"
    | "optionalTools"
    | "defaultPorts"
  >;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const now = new Date();
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      version: `edited-${now.toISOString()}`,
      displayName: params.profile.displayName,
      description: params.profile.description,
      setupCommands: params.profile.setupCommands.map(normalizeCommand),
      verificationCommands:
        params.profile.verificationCommands.map(normalizeCommand),
      expectedTools: params.profile.expectedTools,
      optionalTools: params.profile.optionalTools,
      defaultPorts: params.profile.defaultPorts,
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.scope, "user_default"),
      ),
    )
    .returning();

  return profile;
}

export type DeleteUserDefaultProfileResult = ManagedRuntimeSavedProfile & {
  /** True when user_preferences.default_managed_runtime_profile_id referenced this profile and was reset to the built-in default. */
  preferenceReset: boolean;
};

/**
 * Delete an account-level profile. The scope guard ensures session profiles
 * cannot be accidentally deleted via this path. Per Decision D2, if
 * `user_preferences.default_managed_runtime_profile_id` references the
 * deleted profile, it is reset to the built-in default in the same
 * transaction so Preferences never points at a profile that no longer
 * exists. Emits `managed_runtime.profile.preference_reset` after the
 * transaction commits (warn-and-continue — Decision D8).
 */
export async function deleteUserDefaultProfile(params: {
  userId: string;
  profileId: string;
}): Promise<DeleteUserDefaultProfileResult | undefined> {
  const result = await db.transaction(async (tx) => {
    const [profile] = await tx
      .delete(managedRuntimeSavedProfiles)
      .where(
        and(
          eq(managedRuntimeSavedProfiles.id, params.profileId),
          eq(managedRuntimeSavedProfiles.userId, params.userId),
          eq(managedRuntimeSavedProfiles.scope, "user_default"),
        ),
      )
      .returning();

    if (!profile) {
      return undefined;
    }

    const [resetPreferences] = await tx
      .update(userPreferences)
      .set({
        defaultManagedRuntimeProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userPreferences.userId, params.userId),
          eq(userPreferences.defaultManagedRuntimeProfileId, params.profileId),
        ),
      )
      .returning();

    return { profile, resetPreferences };
  });

  if (!result) {
    return undefined;
  }

  const preferenceReset = Boolean(result.resetPreferences);

  if (preferenceReset) {
    // Account-level action (no session context): `session_events.session_id`
    // is a NOT NULL FK to `sessions.id`, so this cannot be persisted as a
    // session event. Structured log mirrors emitSessionEvent's own
    // warn-and-continue shape; the API response's `preferenceReset: true`
    // field is the durable evidence surface (see #808 API contract).
    emitManagedRuntimePreferenceResetLog({
      userId: params.userId,
      deletedProfileId: params.profileId,
      newDefaultProfileId: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
    });
  }

  return { ...result.profile, preferenceReset };
}

// ---------------------------------------------------------------------------

export async function finishManagedRuntimeSavedProfileTest(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage?: string | null;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const now = new Date();
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      testResults: params.testResults,
      testFailureMessage: params.testFailureMessage ?? null,
      testedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}
