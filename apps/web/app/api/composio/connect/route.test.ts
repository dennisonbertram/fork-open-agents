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

const authConfigsList = mock(
  async (_query: { toolkit: string; isComposioManaged?: boolean }) => ({
    items: [] as Array<{ id?: string | null }>,
  }),
);
const authConfigsCreate = mock(
  async (_toolkit: string, _options: { type: string }) => ({
    id: "ac_gmail_managed",
  }),
);

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
    authConfigs: {
      list: authConfigsList,
      create: authConfigsCreate,
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
    authConfigsList.mockClear();
    authConfigsCreate.mockClear();
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
    expect(authConfigsCreate).not.toHaveBeenCalled();
    expect(body).toEqual({
      id: "connection-request-1",
      redirectUrl: "https://composio.dev/connect/request-1",
    });
  });

  test("toolkitSlug: resolves a managed auth config, then links (no deprecated authorize path)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ toolkitSlug: "gmail" }));
    const body = (await response.json()) as {
      id: string;
      redirectUrl: string;
    };

    expect(response.status).toBe(200);
    // empty list → create a managed auth config, then link with its id
    expect(authConfigsList).toHaveBeenCalledWith({
      toolkit: "gmail",
      isComposioManaged: true,
    });
    expect(authConfigsCreate).toHaveBeenCalledWith("gmail", {
      type: "use_composio_managed_auth",
    });
    expect(link).toHaveBeenCalledWith(
      "open_agents_user_user-1",
      "ac_gmail_managed",
      {},
    );
    expect(body).toEqual({
      id: "connection-request-1",
      redirectUrl: "https://composio.dev/connect/request-1",
    });
  });

  test("toolkitSlug: reuses an existing managed auth config", async () => {
    authConfigsList.mockResolvedValueOnce({ items: [{ id: "ac_existing" }] });
    const { POST } = await routeModulePromise;

    const response = await POST(post({ toolkitSlug: "notion" }));

    expect(response.status).toBe(200);
    expect(authConfigsCreate).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith(
      "open_agents_user_user-1",
      "ac_existing",
      {},
    );
  });

  test("rejects when neither toolkitSlug nor authConfigId is provided", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ alias: "work" }));

    expect(response.status).toBe(400);
    expect(link).not.toHaveBeenCalled();
  });

  test("rejects invalid connect payloads (empty authConfigId)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ authConfigId: "" }));

    expect(response.status).toBe(400);
    expect(link).not.toHaveBeenCalled();
  });
});
