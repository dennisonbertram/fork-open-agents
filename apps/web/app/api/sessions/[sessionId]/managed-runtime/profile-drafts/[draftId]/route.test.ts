import { beforeEach, describe, expect, mock, test } from "bun:test";

let authenticatedUser:
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    } = { ok: true, userId: "user-1" };
let ownedSession:
  | {
      ok: true;
      sessionRecord: { id: string; userId: string };
    }
  | {
      ok: false;
      response: Response;
    } = {
  ok: true,
  sessionRecord: { id: "session-1", userId: "user-1" },
};

const draftRecord = {
  id: "draft-1",
  userId: "user-1",
  sessionId: "session-1",
  chatId: "chat-1",
  toolCallId: "tool-1",
  status: "approved",
  targetScope: "session",
  goal: "Set up this app",
  repoSignals: [],
  profileDraft: {
    displayName: "Bun app",
    description: "Install and verify Bun",
    setupCommands: [
      {
        id: "install-bun",
        label: "Install Bun",
        description: "Install Bun",
        command: "bun --version",
      },
    ],
    verificationCommands: [
      {
        id: "verify-bun",
        label: "Verify Bun",
        description: "Verify Bun",
        command: "bun --version",
      },
    ],
    expectedTools: ["bun"],
    optionalTools: [],
    defaultPorts: [3000],
  },
  questionsForUser: [],
  latestTestRunId: null,
  userInstructions: null,
  userDecision: "approved",
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:00:00.000Z"),
};

const calls: Array<Record<string, unknown>> = [];
let draftResult: typeof draftRecord | undefined = draftRecord;
const savedProfileRecord = {
  id: "session-profile-draft-1",
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
  requireOwnedSession: async () => ownedSession,
  requireOwnedSessionWithSandboxGuard: async () =>
    ownedSession.ok
      ? {
          ok: true,
          sessionRecord: {
            ...ownedSession.sessionRecord,
            sandboxState: {
              type: "vercel",
              sandboxName: "session_session-1",
              expiresAt: Date.now() + 60_000,
            },
          },
        }
      : ownedSession,
}));

mock.module("@/lib/db/managed-runtime-profile-drafts", () => ({
  getManagedRuntimeProfileDraft: async (params: Record<string, unknown>) => {
    calls.push({ fn: "get", ...params });
    return draftResult;
  },
  finishManagedRuntimeProfileDraftTest: async (
    params: Record<string, unknown>,
  ) =>
    draftResult
      ? {
          ...draftResult,
          status: params.status,
          testResults: params.testResults,
          testFailureMessage: params.testFailureMessage ?? null,
          testedAt: new Date("2026-05-24T00:01:00.000Z"),
        }
      : undefined,
  markManagedRuntimeProfileDraftTesting: async () =>
    draftResult ? { ...draftResult, status: "testing" } : undefined,
  toManagedRuntimeProfileDraftSnapshot: (draft: typeof draftRecord) => ({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }),
  updateManagedRuntimeProfileDraftDecision: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "update", ...params });
    return draftResult;
  },
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  applyDraftAsSessionManagedRuntimeProfile: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "apply", ...params });
    return savedProfileRecord;
  },
  getManagedRuntimeSavedProfile: async () => savedProfileRecord,
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({
      sessionId: "session-1",
      draftId: "draft-1",
    }),
  };
}

function request(method: "GET" | "PATCH", body?: unknown) {
  return new Request(
    "http://localhost/api/sessions/session-1/managed-runtime/profile-drafts/draft-1",
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

describe("/api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId]", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    ownedSession = {
      ok: true,
      sessionRecord: { id: "session-1", userId: "user-1" },
    };
    draftResult = draftRecord;
    calls.length = 0;
  });

  test("GET returns a persisted profile draft", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as { draft: { id: string } };

    expect(response.status).toBe(200);
    expect(body.draft.id).toBe("draft-1");
    expect(calls[0]).toMatchObject({
      fn: "get",
      userId: "user-1",
      sessionId: "session-1",
      draftId: "draft-1",
    });
  });

  test("PATCH records an approval decision and applies it to the session", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        output: { decision: "approved", notes: "Looks right" },
      }),
      routeContext(),
    );
    const body = (await response.json()) as {
      draft: { id: string };
      savedProfileId: string;
      appliedToSessionId: string;
    };

    expect(response.status).toBe(200);
    expect(body.draft.id).toBe("draft-1");
    expect(body.savedProfileId).toBe("session-profile-draft-1");
    expect(body.appliedToSessionId).toBe("session-1");
    expect(calls[0]).toMatchObject({
      fn: "update",
      userId: "user-1",
      sessionId: "session-1",
      draftId: "draft-1",
      output: { decision: "approved", notes: "Looks right" },
    });
    expect(calls[1]).toMatchObject({
      fn: "apply",
      userId: "user-1",
      sessionId: "session-1",
      draft: draftRecord,
    });
  });

  // Regression: a normal approval (no forceApproved in the request body)
  // must NOT be persisted as force_approved:true. This would fail if a
  // future change hardcoded forceApproved:true or otherwise defaulted the
  // flag on for every approval, which would mislabel every ordinary
  // approval as an override in the evidence badge.
  test("PATCH does not mark a normal approval as forceApproved", async () => {
    const { PATCH } = await routeModulePromise;

    await PATCH(
      request("PATCH", {
        output: { decision: "approved", notes: "Looks right" },
      }),
      routeContext(),
    );

    expect(calls[0]).toMatchObject({ fn: "update" });
    expect((calls[0] as { forceApproved?: boolean }).forceApproved).toBe(
      undefined,
    );
  });

  // RED: today the route never reads or persists a `forceApproved` flag, so
  // approving over a failed/absent test leaves no evidence that the user
  // knowingly overrode the failure.
  test("PATCH persists forceApproved when approving over a failed test", async () => {
    draftResult = { ...draftRecord, status: "needs_changes" };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        output: { decision: "approved", notes: "Approving anyway" },
        forceApproved: true,
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({
      fn: "update",
      forceApproved: true,
    });
  });

  test("PATCH rejects invalid decision payloads", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", { output: { decision: "maybe" } }),
      routeContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid managed runtime profile draft update");
    expect(calls).toEqual([]);
  });

  test("PATCH returns 404 when the draft is missing", async () => {
    draftResult = undefined;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      request("PATCH", {
        output: { decision: "discarded", reason: "No longer needed" },
      }),
      routeContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile draft not found");
  });
});
