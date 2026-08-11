import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Minimal stand-in for better-auth's `auth` instance. withMcpAuth (real,
// unmocked, imported from better-auth/plugins) reads `auth.options.baseURL`
// to build the WWW-Authenticate resource_metadata URL and calls
// `auth.api.getMcpSession` to resolve the caller's session — mocking just
// that call keeps this test off the database and off the network while
// still exercising the real OAuth-boundary logic.
const getMcpSession = mock(
  async (): Promise<Record<string, unknown> | null> => null,
);

mock.module("@/lib/auth/config", () => ({
  auth: {
    options: { baseURL: "http://localhost:3000" },
    api: { getMcpSession },
  },
}));

const routeModulePromise = import("./route");

function mcpRequest(method: string): Request {
  return new Request("http://localhost:3000/api/mcp/http", { method });
}

describe("/api/mcp/[transport] auth boundary", () => {
  beforeEach(() => {
    getMcpSession.mockClear();
    getMcpSession.mockImplementation(async () => null);
  });

  test("POST with no authenticated MCP session returns 401", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(mcpRequest("POST"));

    expect(response.status).toBe(401);
  });

  test("GET with no authenticated MCP session returns 401", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(mcpRequest("GET"));

    expect(response.status).toBe(401);
  });

  test("DELETE with no authenticated MCP session returns 401", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(mcpRequest("DELETE"));

    expect(response.status).toBe(401);
  });

  test("401 response carries a WWW-Authenticate header referencing the protected-resource metadata URL", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(mcpRequest("POST"));
    const challenge = response.headers.get("WWW-Authenticate");

    expect(challenge).not.toBeNull();
    expect(challenge).toContain(
      "http://localhost:3000/.well-known/oauth-protected-resource",
    );
  });

  test("an authenticated request never reaches the tool dispatch for a request that fails auth", async () => {
    const { POST } = await routeModulePromise;

    await POST(mcpRequest("POST"));

    expect(getMcpSession).toHaveBeenCalledTimes(1);
  });
});
