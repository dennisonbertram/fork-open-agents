import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let toolkitsGetThrows: Error | null = null;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test_key" }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    toolkits: {
      get: async () => {
        if (toolkitsGetThrows) {
          throw toolkitsGetThrows;
        }
        return { items: [] };
      },
    },
  }),
}));

const routePromise = import("./route");

describe("GET /api/composio/toolkits", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    toolkitsGetThrows = null;
  });

  test("redacts an API key fragment from the 502 error body", async () => {
    toolkitsGetThrows = new Error(
      'FatalError: 401 {"error":{"message":"Invalid API key: ak_secret123","code":10401}}',
    );
    const { GET } = await routePromise;

    const res = await GET();
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("ak_[redacted]");
    expect(body.error).not.toContain("ak_secret123");
  });
});
