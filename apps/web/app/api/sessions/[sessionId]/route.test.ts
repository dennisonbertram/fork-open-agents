import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthSession = { user: { id: string } } | null;
type SessionRecord = {
  id: string;
  userId: string;
  status: "running" | "completed" | "failed" | "archived";
  managedRuntimeProfileId: string;
  sandboxState: null;
};

let authSession: AuthSession = { user: { id: "user-1" } };
let sessionRecord: SessionRecord | null = {
  id: "session-1",
  userId: "user-1",
  status: "running",
  managedRuntimeProfileId: "web-bun-agent-browser",
  sandboxState: null,
};
const updateSessionCalls: Array<{
  sessionId: string;
  update: Record<string, unknown>;
}> = [];
let savedProfileExists = false;

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
      sandboxState: null,
    };
    updateSessionCalls.length = 0;
    savedProfileExists = false;
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
    expect(body.error).toBe("Invalid runtime mode");
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
});
