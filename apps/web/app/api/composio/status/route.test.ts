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
const connectedAccountsList = mock(async (_params: unknown) => ({}));
let clientError: Error | null = null;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ({
    ok: false,
    response: Response.json({ error: "Not found" }, { status: 404 }),
  }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => {
    if (clientError) {
      throw clientError;
    }
    return {
      connectedAccounts: {
        list: connectedAccountsList,
      },
    };
  },
}));

const routeModulePromise = import("./route");

function createRequest(path = "/api/composio/status"): Request {
  return new Request(`http://localhost${path}`);
}

describe("/api/composio/status", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    clientError = null;
    connectedAccountsList.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expect(connectedAccountsList).not.toHaveBeenCalled();
  });

  test("reports missing Composio API key without leaking secrets", async () => {
    clientError = new Error("COMPOSIO_API_KEY is not configured.");
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());
    const body = (await response.json()) as {
      status: { configured: boolean; available: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toMatchObject({
      configured: false,
      available: false,
      message: "COMPOSIO_API_KEY is not configured.",
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  test("live check scopes the lookup to the Composio user id", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest("/api/composio/status?live=1"));

    expect(response.status).toBe(200);
    expect(connectedAccountsList).toHaveBeenCalledWith({
      userIds: ["open_agents_user_user-1"],
    });
  });

  test("reports invalid Composio API keys as an actionable status", async () => {
    clientError = new Error(
      '401 {"error":{"message":"Invalid API key: ak_invalid","code":10401}}',
    );
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest("/api/composio/status?live=1"));
    const body = (await response.json()) as {
      status: { reason: string; available: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toMatchObject({
      reason: "invalid_api_key",
      available: false,
    });
    expect(body.status.message).toContain("COMPOSIO_API_KEY is invalid");
    expect(body.status.message).not.toContain("ak_invalid");
  });
});
