import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const sessionState: { userId: string | null } = { userId: "user-1" };
const tokenState: { token: string | null } = { token: "gho_token" };

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: mock(async () =>
    sessionState.userId ? { user: { id: sessionState.userId } } : null,
  ),
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: mock(async () => tokenState.token),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  sessionState.userId = "user-1";
  tokenState.token = "gho_token";
});

async function callRoute(): Promise<{ body: unknown; status: number }> {
  const { GET } = await import("./route");
  const response = await GET();
  return { body: await response.json(), status: response.status };
}

describe("GET /api/github/orgs", () => {
  test("returns 401 when GitHub rejects the stored token", async () => {
    globalThis.fetch = mock(
      async () => new Response("Bad credentials", { status: 401 }),
    ) as unknown as typeof fetch;

    const { body, status } = await callRoute();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "GitHub not connected" });
  });

  test("returns 500 when GitHub fails for a non-auth reason", async () => {
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;

    const { status } = await callRoute();

    expect(status).toBe(500);
  });

  test("returns the organizations on success", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify([
            { login: "acme", avatar_url: "https://example.test/o.png" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const { body, status } = await callRoute();

    expect(status).toBe(200);
    expect(body).toEqual([
      {
        login: "acme",
        name: "acme",
        avatar_url: "https://example.test/o.png",
      },
    ]);
  });
});
