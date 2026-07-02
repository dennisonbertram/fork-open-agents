import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// Follows the chainable-mock pattern used in
// apps/web/lib/agent-loops/d1-coalesce-date-fix.test.ts.

let deletedSavedProfile: Record<string, unknown> | undefined;
let sessionRow: Record<string, unknown> | undefined;
let userPreferencesRow: Record<string, unknown> | undefined;

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
      return {
        where: mock(() => ({
          returning: mock(() => (sessionRow ? [sessionRow] : [])),
        })),
      };
    }
    if ("defaultManagedRuntimeProfileId" in setVals) {
      preferencesUpdateSetCalls.push(setVals);
      return {
        where: mock(() => ({
          returning: mock(() =>
            userPreferencesRow ? [userPreferencesRow] : [],
          ),
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
      managedRuntimeSavedProfiles: { findFirst: mock(async () => undefined) },
    },
  },
}));

const emitSessionEventMock = mock(async () => null);
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: emitSessionEventMock,
}));

const storeModulePromise = import("./managed-runtime-saved-profiles");

function resetMocks() {
  deletedSavedProfile = undefined;
  sessionRow = undefined;
  userPreferencesRow = undefined;
  sessionUpdateSetCalls.length = 0;
  preferencesUpdateSetCalls.length = 0;
  txDeleteMock.mockClear();
  txUpdateMock.mockClear();
  txQueryFindFirstMock.mockClear();
  emitSessionEventMock.mockClear();
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
      runtimeMode: "classic",
      managedRuntimeProfileId: "web-bun-agent-browser",
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
    expect(emitSessionEventMock).toHaveBeenCalledTimes(1);
    const [eventArgs] = emitSessionEventMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(eventArgs.eventName).toBe(
      "managed_runtime.profile.preference_reset",
    );
  });

  test("does not touch user_preferences when it references a different profile", async () => {
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
    expect(preferencesUpdateSetCalls).toEqual([]);
    expect(emitSessionEventMock).not.toHaveBeenCalled();
  });
});
