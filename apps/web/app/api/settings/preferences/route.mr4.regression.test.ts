/**
 * Regression tests for MR-4 (#812) — PATCH /api/settings/preferences must
 * keep validating defaultManagedRuntimeProfileId through MR-1's
 * isKnownManagedRuntimeProfileReference (owner-checked) rather than
 * reverting to the built-ins-only isManagedRuntimeProfileId() gate that
 * rejected every user-created profile.
 *
 * - REG-MR4-P-001: an owned user_default profile id must keep being
 *   accepted — this is the exact #1 naive-user defect the ticket fixes.
 * - REG-MR4-P-002: updateUserPreferences must never be called when the
 *   reference check rejects the id (fail-closed, no partial writes).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

const preferencesState = {
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

const updateCalls: Array<Record<string, unknown>> = [];
let knownReferenceResult = true;
const knownReferenceCalls: Array<{ userId: string; profileId: string }> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => preferencesState,
  updateUserPreferences: async (
    _userId: string,
    updates: Record<string, unknown>,
  ) => {
    updateCalls.push(updates);
    return { ...preferencesState, ...updates };
  },
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  isKnownManagedRuntimeProfileReference: async (params: {
    userId: string;
    profileId: string;
  }) => {
    knownReferenceCalls.push({
      userId: params.userId,
      profileId: params.profileId,
    });
    return knownReferenceResult;
  },
}));

const routeModulePromise = import("./route");

function createPatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("MR-4 (#812) regression — preferences profile reference check", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    knownReferenceCalls.length = 0;
    knownReferenceResult = true;
  });

  test("REG-MR4-P-001: an owned user_default profile id is accepted (the #1 naive-user defect stays fixed)", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        defaultManagedRuntimeProfileId: "user-profile-mine",
      }),
    );

    expect(response.status).toBe(200);
    expect(knownReferenceCalls).toHaveLength(1);
    expect(knownReferenceCalls[0]?.profileId).toBe("user-profile-mine");
    expect(updateCalls).toEqual([
      { defaultManagedRuntimeProfileId: "user-profile-mine" },
    ]);
  });

  test("REG-MR4-P-002: updateUserPreferences is never called when the reference check rejects the id", async () => {
    knownReferenceResult = false;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        defaultManagedRuntimeProfileId: "someone-elses-profile",
      }),
    );

    expect(response.status).toBe(400);
    // If the fail-closed check regresses (e.g. swallows the false result),
    // this would be non-empty.
    expect(updateCalls).toHaveLength(0);
  });
});
