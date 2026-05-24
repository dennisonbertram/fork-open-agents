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
let ownedSessionChat:
  | {
      ok: true;
      sessionRecord: { id: string; userId: string };
      chat: { id: string; sessionId: string };
    }
  | {
      ok: false;
      response: Response;
    } = {
  ok: true,
  sessionRecord: { id: "session-1", userId: "user-1" },
  chat: { id: "chat-1", sessionId: "session-1" },
};

const draftRecord = {
  id: "draft-1",
  userId: "user-1",
  sessionId: "session-1",
  chatId: "chat-1",
  toolCallId: "tool-1",
  status: "draft_ready",
  targetScope: "session",
  goal: "Set up this app",
  repoSignals: ["package.json uses bun"],
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
  userDecision: null,
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:00:00.000Z"),
};

const calls: Array<Record<string, unknown>> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
  requireOwnedSession: async () => ownedSession,
  requireOwnedSessionChat: async () => ownedSessionChat,
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
  getManagedRuntimeProfileDraft: async () => draftRecord,
  finishManagedRuntimeProfileDraftTest: async (
    params: Record<string, unknown>,
  ) => ({
    ...draftRecord,
    status: params.status,
    testResults: params.testResults,
    testFailureMessage: params.testFailureMessage ?? null,
    testedAt: new Date("2026-05-24T00:01:00.000Z"),
  }),
  listManagedRuntimeProfileDrafts: async (params: Record<string, unknown>) => {
    calls.push({ fn: "list", ...params });
    return [draftRecord];
  },
  markManagedRuntimeProfileDraftTesting: async () => ({
    ...draftRecord,
    status: "testing",
  }),
  toManagedRuntimeProfileDraftSnapshot: (draft: typeof draftRecord) => ({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }),
  upsertManagedRuntimeProfileDraftForToolCall: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "upsert", ...params });
    return draftRecord;
  },
  updateManagedRuntimeProfileDraftDecision: async () => draftRecord,
}));

const routeModulePromise = import("./route");

function routeContext() {
  return { params: Promise.resolve({ sessionId: "session-1" }) };
}

function request(method: "GET" | "POST", body?: unknown) {
  return new Request(
    "http://localhost/api/sessions/session-1/managed-runtime/profile-drafts?chatId=chat-1",
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

function validInput() {
  return {
    goal: "Set up this app",
    repoSignals: ["package.json uses bun"],
    draft: draftRecord.profileDraft,
    questionsForUser: [],
  };
}

describe("/api/sessions/[sessionId]/managed-runtime/profile-drafts", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    ownedSession = {
      ok: true,
      sessionRecord: { id: "session-1", userId: "user-1" },
    };
    ownedSessionChat = {
      ok: true,
      sessionRecord: { id: "session-1", userId: "user-1" },
      chat: { id: "chat-1", sessionId: "session-1" },
    };
    calls.length = 0;
  });

  test("GET lists persisted profile drafts for the session", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(request("GET"), routeContext());
    const body = (await response.json()) as { drafts: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.drafts[0]?.id).toBe("draft-1");
    expect(calls[0]).toMatchObject({
      fn: "list",
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
    });
  });

  test("POST upserts a profile draft for a tool call", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      request("POST", {
        chatId: "chat-1",
        toolCallId: "tool-1",
        input: validInput(),
      }),
      routeContext(),
    );
    const body = (await response.json()) as { draft: { id: string } };

    expect(response.status).toBe(200);
    expect(body.draft.id).toBe("draft-1");
    expect(calls[0]).toMatchObject({
      fn: "upsert",
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      toolCallId: "tool-1",
    });
  });

  test("POST rejects invalid draft payloads", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      request("POST", {
        chatId: "chat-1",
        toolCallId: "tool-1",
        input: { goal: "missing draft" },
      }),
      routeContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid managed runtime profile draft");
    expect(calls).toEqual([]);
  });
});
