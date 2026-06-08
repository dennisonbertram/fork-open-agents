import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const link = mock(
  async (
    _userId: string,
    _authConfigId: string,
    _options: Record<string, unknown>,
  ) => ({
    id: "connection-request-1",
    redirectUrl: "https://composio.dev/connect/request-1",
  }),
);

const authorize = mock(async (_userId: string, _toolkitSlug: string) => ({
  id: "connection-request-2",
  redirectUrl: "https://composio.dev/oauth/gmail",
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      link,
    },
    toolkits: {
      authorize,
    },
  }),
}));

const routeModulePromise = import("./route");

function post(body: unknown): Request {
  return new Request("http://localhost/api/composio/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/composio/connect", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    link.mockClear();
    authorize.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(post({ authConfigId: "auth-1" }));

    expect(response.status).toBe(401);
    expect(link).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  test("creates a Composio-managed connection link via authConfigId (legacy path)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      post({
        authConfigId: "auth-1",
        alias: "github-work",
        callbackUrl: "https://open-agents.dev/settings/composio",
      }),
    );
    const body = (await response.json()) as {
      id: string;
      redirectUrl: string;
    };

    expect(response.status).toBe(200);
    expect(link).toHaveBeenCalledWith("open_agents_user_user-1", "auth-1", {
      alias: "github-work",
      callbackUrl: "https://open-agents.dev/settings/composio",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(body).toEqual({
      id: "connection-request-1",
      redirectUrl: "https://composio.dev/connect/request-1",
    });
  });

  test("creates connection via toolkitSlug (preferred one-click path)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ toolkitSlug: "gmail" }));
    const body = (await response.json()) as {
      id: string;
      redirectUrl: string;
    };

    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith("open_agents_user_user-1", "gmail");
    expect(link).not.toHaveBeenCalled();
    expect(body).toEqual({
      id: "connection-request-2",
      redirectUrl: "https://composio.dev/oauth/gmail",
    });
  });

  test("toolkitSlug takes priority when both toolkitSlug and authConfigId are provided", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      post({ toolkitSlug: "gmail", authConfigId: "auth-1" }),
    );

    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith("open_agents_user_user-1", "gmail");
    expect(link).not.toHaveBeenCalled();
  });

  test("rejects when neither toolkitSlug nor authConfigId is provided", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ alias: "work" }));

    expect(response.status).toBe(400);
    expect(link).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  test("rejects invalid connect payloads (empty authConfigId)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ authConfigId: "" }));

    expect(response.status).toBe(400);
    expect(link).not.toHaveBeenCalled();
  });
});
