import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// Follows the chainable-mock pattern used in
// apps/web/lib/agent-loops/d1-coalesce-date-fix.test.ts.

let deletedSavedProfile: Record<string, unknown> | undefined;
let sessionRow: Record<string, unknown> | undefined;
let userPreferencesRow: Record<string, unknown> | undefined;
let knownProfileLookupResult: Record<string, unknown> | undefined;

const txDeleteWhereMock = mock(() =>
  Promise.resolve({
    returning: mock(() =>
      deletedSavedProfile ? [deletedSavedProfile] : [],
    ),
  }),
);
const txDeleteMock = mock((_table: unknown) => ({
  where: mock(() => ({
    returning: mock(() => (deletedSavedProfile ? [deletedSavedProfile] : [])),
  })),
}));

const sessionUpdateSetCalls: Array<Record<string, unknown>> = [];
const preferencesUpdateSetCalls: Array<Record<string, unknown>> = [];

const txUpdateMock = mock((table: unknown) => ({
  set: mock((setVals: Record<string, unknown>) => {
    // Distinguish sessions vs user_preferences updates by shape of setVals.
    if ("runtimeMode" in setVals || "managedRuntimeProfileId" in setVals) {
      sessionUpdateSetCalls.push(setVals);
      // Real WHERE: sessions.managedRuntimeProfileId = deleted profile id.
      // Only "matches" (returns a row) if the fixture's sessionRow currently
      // points at the profile being deleted.
      const matches =
        sessionRow &&
        deletedSavedProfile &&
        sessionRow.managedRuntimeProfileId === deletedSavedProfile.id;
      return {
        where: mock(() => ({
          returning: mock(() => (matches ? [sessionRow] : [])),
        })),
      };
    }
    if ("defaultManagedRuntimeProfileId" in setVals) {
      preferencesUpdateSetCalls.push(setVals);
      // Real WHERE: userPreferences.defaultManagedRuntimeProfileId = deleted
      // profile id. Only "matches" if the fixture currently references it.
      const matches =
        userPreferencesRow &&
        deletedSavedProfile &&
        userPreferencesRow.defaultManagedRuntimeProfileId ===
          deletedSavedProfile.id;
      return {
        where: mock(() => ({
          returning: mock(() => (matches ? [userPreferencesRow] : [])),
        })),
      };
    }
    return {
      where: mock(() => ({ returning: mock(() => []) })),
    };
  }),
}));

const txQueryFindFirstMock = mock(async () => sessionRow ?? null);

mock.module("@/lib/db/client", () => ({
  db: {
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        delete: txDeleteMock,
        update: txUpdateMock,
        query: {
          sessions: { findFirst: txQueryFindFirstMock },
          userPreferences: { findFirst: txQueryFindFirstMock },
        },
      }),
    ),
    query: {
      managedRuntimeSavedProfiles: {
        findFirst: mock(async () => knownProfileLookupResult),
      },
    },
  },
}));

const emitSessionEventMock = mock(async () => null);
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: emitSessionEventMock,
}));

const consoleInfoMock = mock(() => undefined);
console.info = consoleInfoMock as unknown as typeof console.info;

const storeModulePromise = import("./managed-runtime-saved-profiles");

function resetMocks() {
  deletedSavedProfile = undefined;
  sessionRow = undefined;
  userPreferencesRow = undefined;
  knownProfileLookupResult = undefined;
  sessionUpdateSetCalls.length = 0;
  preferencesUpdateSetCalls.length = 0;
  txDeleteMock.mockClear();
  txUpdateMock.mockClear();
  txQueryFindFirstMock.mockClear();
  emitSessionEventMock.mockClear();
  consoleInfoMock.mockClear();
}

describe("deleteManagedRuntimeSavedProfile — delete lifecycle (Decision D2)", () => {
  beforeEach(resetMocks);

  // RED: today the store only resets `managedRuntimeProfileId` to the
  // fallback id (managed-runtime-saved-profiles.ts:147-159) and never resets
  // runtimeMode back to "classic", and never emits an observability event.
  test("resets an active session's runtimeMode to classic and emits deleted_active_reset", async () => {
    deletedSavedProfile = {
      id: "session-profile-draft-1",
      userId: "user-1",
      sessionId: "session-1",
      scope: "session",
    };
    sessionRow = {
      id: "session-1",
      userId: "user-1",
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "session-profile-draft-1",
    };

    const { deleteManagedRuntimeSavedProfile } = await storeModulePromise;

    const result = await deleteManagedRuntimeSavedProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
      fallbackProfileId: "web-bun-agent-browser",
    });

    expect(result).toBeDefined();
    expect(sessionUpdateSetCalls[0]).toMatchObject({
      runtimeMode: "classic",
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
    expect(emitSessionEventMock).toHaveBeenCalledTimes(1);
    const [eventArgs] = emitSessionEventMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(eventArgs.eventName).toBe(
      "managed_runtime.profile.deleted_active_reset",
    );
    expect(eventArgs.source).toBe("managed_runtime");
  });

  // REGRESSION: deleting a session-scope profile that is NOT the session's
  // currently active profile must NOT reset runtimeMode or emit the
  // deleted_active_reset event. Guards against an over-eager reset that
  // would flip a session back to classic every time ANY of its saved
  // profiles is deleted, not just the active one.
  test("regression: does not reset runtimeMode or emit an event when the deleted profile is not the session's active profile", async () => {
    deletedSavedProfile = {
      id: "session-profile-inactive",
      userId: "user-1",
      sessionId: "session-1",
      scope: "session",
    };
    sessionRow = {
      id: "session-1",
      userId: "user-1",
      runtimeMode: "managed_runtime",
      // The session is active on a DIFFERENT profile than the one deleted.
      managedRuntimeProfileId: "session-profile-currently-active",
    };

    const { deleteManagedRuntimeSavedProfile } = await storeModulePromise;

    const result = await deleteManagedRuntimeSavedProfile({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "session-profile-inactive",
      fallbackProfileId: "web-bun-agent-browser",
    });

    expect(result).toBeDefined();
    expect(result?.sessionsReset).toBe(false);
    expect(emitSessionEventMock).not.toHaveBeenCalled();
  });
});

describe("deleteUserDefaultProfile — preference reset lifecycle (Decision D2)", () => {
  beforeEach(resetMocks);

  // RED: today deleteUserDefaultProfile is a bare delete with no
  // user_preferences cleanup at all.
  test("resets user_preferences.default_managed_runtime_profile_id in the same transaction when it references the deleted profile", async () => {
    deletedSavedProfile = {
      id: "user-profile-abc123",
      userId: "user-1",
      scope: "user_default",
    };
    userPreferencesRow = {
      id: "pref-1",
      userId: "user-1",
      defaultManagedRuntimeProfileId: "user-profile-abc123",
    };

    const { deleteUserDefaultProfile } = await storeModulePromise;

    const result = await deleteUserDefaultProfile({
      userId: "user-1",
      profileId: "user-profile-abc123",
    });

    expect(result).toBeDefined();
    expect(result?.preferenceReset).toBe(true);
    expect(preferencesUpdateSetCalls[0]).toMatchObject({
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
    });
    // No sessionId exists for this account-level action, so the reset
    // cannot be persisted as a session_events row (session_id is a NOT NULL
    // FK). The API response's preferenceReset:true field is the durable
    // evidence surface for callers.
    expect(consoleInfoMock).toHaveBeenCalledTimes(1);
    const [, logPayload] = consoleInfoMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(logPayload).toMatchObject({
      userId: "user-1",
      deletedProfileId: "user-profile-abc123",
      newDefaultProfileId: "web-bun-agent-browser",
    });
  });

  test("leaves user_preferences unreset when it references a different profile", async () => {
    deletedSavedProfile = {
      id: "user-profile-abc123",
      userId: "user-1",
      scope: "user_default",
    };
    userPreferencesRow = {
      id: "pref-1",
      userId: "user-1",
      defaultManagedRuntimeProfileId: "user-profile-other",
    };

    const { deleteUserDefaultProfile } = await storeModulePromise;

    const result = await deleteUserDefaultProfile({
      userId: "user-1",
      profileId: "user-profile-abc123",
    });

    expect(result).toBeDefined();
    expect(result?.preferenceReset).toBe(false);
    // The row was untouched: it still references the other profile.
    expect(userPreferencesRow?.defaultManagedRuntimeProfileId).toBe(
      "user-profile-other",
    );
    expect(consoleInfoMock).not.toHaveBeenCalled();
  });
});

describe("isKnownManagedRuntimeProfileReference", () => {
  beforeEach(resetMocks);

  // RED: this export does not exist yet — write-path routes have no shared
  // validator and currently accept any string as a profile id reference.
  test("returns true for a built-in profile id without querying the database", async () => {
    const { isKnownManagedRuntimeProfileReference } = await storeModulePromise;

    const known = await isKnownManagedRuntimeProfileReference({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "web-bun-agent-browser",
    });

    expect(known).toBe(true);
  });

  test("returns true for a saved profile owned by the user (session or user_default scope)", async () => {
    knownProfileLookupResult = {
      id: "user-profile-abc123",
      userId: "user-1",
      scope: "user_default",
    };
    const { isKnownManagedRuntimeProfileReference } = await storeModulePromise;

    const known = await isKnownManagedRuntimeProfileReference({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "user-profile-abc123",
    });

    expect(known).toBe(true);
  });

  test("returns false for an id that resolves nowhere", async () => {
    knownProfileLookupResult = undefined;
    const { isKnownManagedRuntimeProfileReference } = await storeModulePromise;

    const known = await isKnownManagedRuntimeProfileReference({
      userId: "user-1",
      sessionId: "session-1",
      profileId: "totally-made-up-id",
    });

    expect(known).toBe(false);
  });
});
