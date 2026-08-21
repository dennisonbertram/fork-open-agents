import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = { user: { id: string } } | null;
type SessionRecord = {
  id: string;
  userId: string;
  status: "running" | "completed" | "failed" | "archived";
  managedRuntimeProfileId: string;
  inferenceProfileId: string | null;
  sandboxState: null;
};

let authSession: AuthSession = { user: { id: "user-1" } };
let sessionRecord: SessionRecord | null = {
  id: "session-1",
  userId: "user-1",
  status: "running",
  managedRuntimeProfileId: "web-bun-agent-browser",
  inferenceProfileId: null,
  sandboxState: null,
};
const updateSessionCalls: Array<{
  sessionId: string;
  update: Record<string, unknown>;
}> = [];
let savedProfileExists = false;
let inferenceProfile: {
  id: string;
  enabled: boolean;
} | null = null;

mock.module("next/server", () => ({
  after: (callback: () => void) => callback(),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/sessions", () => ({
  deleteSession: async () => undefined,
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, update: Record<string, unknown>) => {
    updateSessionCalls.push({ sessionId, update });
    return sessionRecord ? { ...sessionRecord, ...update } : null;
  },
}));

mock.module("@/lib/db/inference-profiles", () => ({
  getInferenceProfileByIdForUser: async (_userId: string, profileId: string) =>
    inferenceProfile?.id === profileId ? inferenceProfile : null,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  applyDraftAsSessionManagedRuntimeProfile: async () => ({
    id: "session-profile-draft-1",
  }),
  getManagedRuntimeSavedProfile: async () =>
    savedProfileExists ? { id: "session-profile-draft-1" } : undefined,
}));

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession: async (
    _sessionId: string,
    params: { currentSession: SessionRecord; update: Record<string, unknown> },
  ) => ({ session: { ...params.currentSession, ...params.update } }),
}));

mock.module("@/lib/sandbox/utils", () => ({
  hasRuntimeSandboxState: () => false,
}));

const routeModulePromise = import("./route");

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/session-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function routeContext() {
  return {
    params: Promise.resolve({ sessionId: "session-1" }),
  };
}

async function getJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/sessions/[sessionId]", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      status: "running",
      managedRuntimeProfileId: "web-bun-agent-browser",
      inferenceProfileId: null,
      sandboxState: null,
    };
    updateSessionCalls.length = 0;
    savedProfileExists = false;
    inferenceProfile = null;
  });

  test("PATCH persists a valid runtime mode", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ runtimeMode: "managed_runtime" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { runtimeMode: "managed_runtime" },
      },
    ]);
    expect((body.session as Record<string, unknown>).runtimeMode).toBe(
      "managed_runtime",
    );
  });

  test("PATCH rejects invalid runtime mode values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ runtimeMode: "always_on" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_session_update");
    expect(updateSessionCalls).toEqual([]);
  });

  test("PATCH persists a valid managed runtime profile", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ managedRuntimeProfileId: "web-bun-agent-browser" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { managedRuntimeProfileId: "web-bun-agent-browser" },
      },
    ]);
    expect(
      (body.session as Record<string, unknown>).managedRuntimeProfileId,
    ).toBe("web-bun-agent-browser");
  });

  test("PATCH rejects invalid managed runtime profiles", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ managedRuntimeProfileId: "unknown-profile" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid managed runtime profile");
    expect(updateSessionCalls).toEqual([]);
  });

  test("PATCH persists a valid saved session managed runtime profile", async () => {
    savedProfileExists = true;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ managedRuntimeProfileId: "session-profile-draft-1" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { managedRuntimeProfileId: "session-profile-draft-1" },
      },
    ]);
    expect(
      (body.session as Record<string, unknown>).managedRuntimeProfileId,
    ).toBe("session-profile-draft-1");
  });

  test("PATCH persists a valid inference profile override", async () => {
    inferenceProfile = { id: "inference-profile-1", enabled: true };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ inferenceProfileId: "inference-profile-1" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { inferenceProfileId: "inference-profile-1" },
      },
    ]);
    expect((body.session as Record<string, unknown>).inferenceProfileId).toBe(
      "inference-profile-1",
    );
  });

  test("PATCH clears an inference profile override", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ inferenceProfileId: null }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { inferenceProfileId: null },
      },
    ]);
  });

  test("PATCH rejects unavailable inference profiles", async () => {
    inferenceProfile = { id: "inference-profile-1", enabled: false };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ inferenceProfileId: "inference-profile-1" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid inference profile");
    expect(updateSessionCalls).toEqual([]);
  });

  test("PATCH rejects mass assignment of non-allowlisted fields", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ title: "ok", userId: "evil", sandboxState: "x" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_session_update");
    expect(updateSessionCalls).toEqual([]);
  });

  test("PATCH persists only the allowlisted fields from the request body", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ title: "renamed" }),
      routeContext(),
    );
    const body = await getJson(response);

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: "session-1",
        update: { title: "renamed" },
      },
    ]);
    expect((body.session as Record<string, unknown>).title).toBe("renamed");
  });
});
