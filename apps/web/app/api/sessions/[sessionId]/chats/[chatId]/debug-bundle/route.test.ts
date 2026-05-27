import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = { user: { id: string } } | null;

const sessionRecord = {
  id: "session-1",
  userId: "user-1",
  title: "Managed runtime demo",
};
const chatRecord = {
  id: "chat-1",
  sessionId: "session-1",
  title: "Demo chat",
};
const debugBundle = {
  bundle: {
    kind: "chat_debug_bundle",
    version: 1,
    generatedAt: "2026-05-27T12:00:00.000Z",
  },
  session: { id: "session-1", runtimeMode: "managed_runtime" },
  chat: { id: "chat-1" },
  runtime: { profileRuns: [] },
  events: [],
};

let currentSession: AuthSession = { user: { id: "user-1" } };
const buildBundleInputs: unknown[] = [];

function registerRouteMocks() {
  mock.module("@/app/api/sessions/_lib/session-context", () => ({
    requireAuthenticatedUser: async () =>
      currentSession
        ? {
            ok: true as const,
            userId: currentSession.user.id,
          }
        : {
            ok: false as const,
            response: Response.json(
              { error: "Not authenticated" },
              { status: 401 },
            ),
          },
    requireOwnedSessionChat: async ({
      userId,
      sessionId,
      chatId,
    }: {
      userId: string;
      sessionId: string;
      chatId: string;
    }) => {
      if (sessionId !== sessionRecord.id) {
        return {
          ok: false as const,
          response: Response.json(
            { error: "Session not found" },
            { status: 404 },
          ),
        };
      }
      if (userId !== sessionRecord.userId) {
        return {
          ok: false as const,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        };
      }
      if (chatId !== chatRecord.id) {
        return {
          ok: false as const,
          response: Response.json({ error: "Chat not found" }, { status: 404 }),
        };
      }
      return {
        ok: true as const,
        sessionRecord,
        chat: chatRecord,
      };
    },
  }));

  mock.module("@/lib/db/sessions", () => ({
    getSessionById: async (sessionId: string) =>
      sessionId === sessionRecord.id ? sessionRecord : null,
    getChatById: async (chatId: string) =>
      chatId === chatRecord.id ? chatRecord : null,
  }));

  mock.module("@/lib/observability/chat-debug-bundle", () => ({
    buildChatDebugBundle: async (input: unknown) => {
      buildBundleInputs.push(input);
      return debugBundle;
    },
    renderChatDebugBundleMarkdown: () => "# Chat Debug Bundle\n",
  }));
}

let routeImportVersion = 0;

async function loadRouteModule() {
  routeImportVersion += 1;
  return import(`./route?test=${routeImportVersion}`);
}

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

describe("/api/sessions/[sessionId]/chats/[chatId]/debug-bundle", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-diagnostic-secret";
    currentSession = { user: { id: "user-1" } };
    buildBundleInputs.length = 0;
    registerRouteMocks();
  });

  test("GET returns an owner-scoped debug bundle", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/debug-bundle",
      ),
      createContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      bundle: { kind: "chat_debug_bundle" },
      session: { id: "session-1" },
      chat: { id: "chat-1" },
    });
    expect(buildBundleInputs).toHaveLength(1);
  });

  test("POST creates a short-lived signed diagnostic URL", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/debug-bundle",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ttlMinutes: 15 }),
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as {
      url: string;
      token: string;
      expiresAt: string;
    };

    expect(response.status).toBe(200);
    expect(body.url).toContain("/debug-bundle?token=");
    expect(body.token.length).toBeGreaterThan(20);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("GET accepts a valid signed token without an auth session", async () => {
    currentSession = null;
    const { createDiagnosticBundleToken } =
      await import("@/lib/observability/diagnostic-token");
    const token = createDiagnosticBundleToken({
      sessionId: "session-1",
      chatId: "chat-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        `http://localhost/api/sessions/session-1/chats/chat-1/debug-bundle?token=${encodeURIComponent(token)}`,
      ),
      createContext(),
    );

    expect(response.status).toBe(200);
  });

  test("GET returns markdown when requested", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/debug-bundle?format=markdown",
      ),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("Chat Debug Bundle");
  });

  test("GET rejects invalid diagnostic tokens", async () => {
    currentSession = null;
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/debug-bundle?token=not-valid",
      ),
      createContext(),
    );

    expect(response.status).toBe(401);
  });
});
