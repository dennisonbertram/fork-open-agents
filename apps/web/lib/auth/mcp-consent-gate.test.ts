import { describe, expect, test } from "bun:test";

const modPromise = import("./mcp-consent-hook");

describe("forceMcpConsentPrompt", () => {
  test("sets prompt=consent when no prompt is present on /mcp/authorize", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const ctx = {
      path: "/mcp/authorize",
      query: { client_id: "abc" },
    };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query.prompt).toBe("consent");
  });

  test("keeps prompt=consent when the client already set it", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const ctx = {
      path: "/mcp/authorize",
      query: { prompt: "consent" },
    };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query.prompt).toBe("consent");
  });

  test("overrides prompt=none (client trying to skip approval)", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const ctx = {
      path: "/mcp/authorize",
      query: { prompt: "none" },
    };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query.prompt).toBe("consent");
  });

  test("overrides prompt=login (client trying to skip approval)", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const ctx = {
      path: "/mcp/authorize",
      query: { prompt: "login" },
    };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query.prompt).toBe("consent");
  });

  test("returns undefined and does not touch the query for /sign-in/social", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const query = { redirect: "https://example.com" };
    const ctx = { path: "/sign-in/social", query };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeUndefined();
    expect(query).toEqual({ redirect: "https://example.com" });
  });

  test("returns undefined for /mcp/token", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const result = forceMcpConsentPrompt({
      path: "/mcp/token",
      query: { grant_type: "authorization_code" },
    });

    expect(result).toBeUndefined();
  });

  test("returns undefined for /mcp/register", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const result = forceMcpConsentPrompt({
      path: "/mcp/register",
      query: { redirect_uris: ["https://example.com/cb"] },
    });

    expect(result).toBeUndefined();
  });

  test("does not mutate the original query object in place", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const originalQuery = { client_id: "abc" };
    const ctx = { path: "/mcp/authorize", query: originalQuery };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query).not.toBe(originalQuery);
    expect(originalQuery).toEqual({ client_id: "abc" });
  });

  test("preserves all other query parameters unchanged", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const ctx = {
      path: "/mcp/authorize",
      query: {
        client_id: "client-123",
        redirect_uri: "https://example.com/cb",
        response_type: "code",
        scope: "sessions:read",
        state: "xyz",
        code_challenge: "challenge-value",
        code_challenge_method: "S256",
      },
    };
    const result = forceMcpConsentPrompt(ctx);

    expect(result).toBeDefined();
    expect(result?.context.query).toEqual({
      client_id: "client-123",
      redirect_uri: "https://example.com/cb",
      response_type: "code",
      scope: "sessions:read",
      state: "xyz",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
      prompt: "consent",
    });
  });

  test("handles /mcp/authorize with no query object at all", async () => {
    const { forceMcpConsentPrompt } = await modPromise;

    const result = forceMcpConsentPrompt({ path: "/mcp/authorize" });

    expect(result).toBeDefined();
    expect(result?.context.query.prompt).toBe("consent");
  });
});
