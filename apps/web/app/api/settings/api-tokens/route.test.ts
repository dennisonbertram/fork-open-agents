import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult;
let createdInput: unknown;
let revokedInput: unknown;

const requireAuthenticatedUser = mock(async () => authResult);
const listApiTokensForUser = mock(async () => [
  {
    id: "token-1",
    name: "Local",
    start: "oa_abcdef",
    last4: "wxyz",
    scopes: ["agent_runs:create"],
  },
]);
const createApiToken = mock(async (input: unknown) => {
  createdInput = input;
  return {
    token: {
      id: "token-1",
      name: "Local",
      start: "oa_abcdef",
      last4: "wxyz",
      scopes: ["agent_runs:create"],
    },
    rawToken: "oa_secret",
  };
});
const revokeApiToken = mock(async (input: unknown) => {
  revokedInput = input;
  return {
    id: "token-1",
    name: "Local",
    revokedAt: new Date("2026-05-30T12:00:00.000Z").toISOString(),
  };
});

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser,
}));
mock.module("@/lib/api-auth/tokens", () => ({
  createApiToken,
  listApiTokensForUser,
  revokeApiToken,
}));

const routeModulePromise = import("./route");

describe("/api/settings/api-tokens", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    createdInput = null;
    revokedInput = null;
    requireAuthenticatedUser.mockClear();
    listApiTokensForUser.mockClear();
    createApiToken.mockClear();
    revokeApiToken.mockClear();
  });

  test("GET lists only redacted token metadata", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tokens[0]).toEqual(
      expect.not.objectContaining({
        rawToken: expect.any(String),
        tokenHash: expect.any(String),
      }),
    );
    expect(listApiTokensForUser).toHaveBeenCalledWith("user-1");
  });

  test("POST creates a token and returns the raw value once", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Local",
          allowedRepositories: ["acme/widgets"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rawToken).toBe("oa_secret");
    expect(createdInput).toMatchObject({
      userId: "user-1",
      name: "Local",
      allowedRepositories: ["acme/widgets"],
    });
  });

  test("DELETE revokes a token scoped to the signed-in user", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/settings/api-tokens?tokenId=token-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(revokedInput).toEqual({ userId: "user-1", tokenId: "token-1" });
  });
});
