/**
 * Route tests for /api/settings/mcp-servers
 *
 * (1) GET unauthenticated → 401
 * (2) POST valid body → 201, header secret NOT in response
 * (3) POST invalid body → 400 with details.fieldErrors naming bad fields
 * (4) POST duplicate name → 409 friendly message, no SQL text
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpServerSummary } from "@/lib/mcp/store";

// Allow server-only imports in test environment
mock.module("server-only", () => ({}));

// ─── mock state ───────────────────────────────────────────────────────────────

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const storedServers: McpServerSummary[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

mock.module("@/lib/mcp/store", () => ({
  listMcpServers: async (_userId: string) => storedServers,
  createMcpServer: async (
    _userId: string,
    input: {
      name: string;
      url: string;
      transport: string;
      headers?: Record<string, string>;
    },
  ): Promise<McpServerSummary> => {
    const hasHeaders =
      input.headers !== undefined && Object.keys(input.headers).length > 0;
    const server: McpServerSummary = {
      id: "srv-1",
      name: input.name,
      url: input.url,
      transport: input.transport as "http" | "sse",
      enabled: true,
      headerKeys: hasHeaders ? Object.keys(input.headers!) : [],
      hasHeaders,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    storedServers.push(server);
    return server;
  },
  updateMcpServer: async () => null,
  deleteMcpServer: async () => false,
  encryptMcpHeaders: (h: Record<string, string>) => JSON.stringify(h),
  decryptMcpHeaders: (v: string | null) =>
    v ? (JSON.parse(v) as Record<string, string>) : null,
}));

const routeModulePromise = import("./route");

// ─── helpers ─────────────────────────────────────────────────────────────────

function validBody() {
  return {
    name: "internal",
    url: "https://mcp.example.com/mcp",
    transport: "http",
    headers: { Authorization: "Bearer s3cret" },
  };
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/settings/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── reset state before each ─────────────────────────────────────────────────

beforeEach(() => {
  authenticatedUser = { ok: true, userId: "user-1" };
  storedServers.length = 0;
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("GET /api/settings/mcp-servers", () => {
  test("(1) returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const res = await GET(
      new Request("http://localhost/api/settings/mcp-servers"),
    );
    expect(res.status).toBe(401);
  });

  test("returns 200 with empty servers list", async () => {
    const { GET } = await routeModulePromise;
    const res = await GET(
      new Request("http://localhost/api/settings/mcp-servers"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: McpServerSummary[] };
    expect(Array.isArray(body.servers)).toBe(true);
  });
});

describe("POST /api/settings/mcp-servers", () => {
  test("(2) valid body → 201 and header secret not in response", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(makePostRequest(validBody()));
    expect(res.status).toBe(201);
    const text = await res.text();
    // The raw secret must not appear anywhere in the response body
    expect(text).not.toContain("s3cret");
    // Must have a server object
    const body = JSON.parse(text) as { server: McpServerSummary };
    expect(body.server).toBeDefined();
    expect(body.server.name).toBe("internal");
  });

  test("(3) invalid body → 400 with fieldErrors naming name and url", async () => {
    const { POST } = await routeModulePromise;
    const res = await POST(makePostRequest({ name: "", url: "notaurl" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { fieldErrors: Record<string, string[]> };
    };
    expect(body.details).toBeDefined();
    expect(body.details.fieldErrors).toBeDefined();
    // Both fields must be named in the error
    expect(Object.keys(body.details.fieldErrors)).toContain("name");
    expect(Object.keys(body.details.fieldErrors)).toContain("url");
  });

  test("(4) duplicate name → 409 friendly message, no SQL text", async () => {
    // Override createMcpServer to throw a duplicate key error
    mock.module("@/lib/mcp/store", () => ({
      listMcpServers: async () => storedServers,
      createMcpServer: async () => {
        throw new Error(
          'duplicate key value violates unique constraint "mcp_servers_user_name_idx"',
        );
      },
      updateMcpServer: async () => null,
      deleteMcpServer: async () => false,
      encryptMcpHeaders: (h: Record<string, string>) => JSON.stringify(h),
      decryptMcpHeaders: (v: string | null) =>
        v ? (JSON.parse(v) as Record<string, string>) : null,
    }));

    const { POST } = await import("./route");
    const res = await POST(makePostRequest(validBody()));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    // Friendly message — not raw SQL
    expect(body.error).toBe("A server with that name already exists.");
    // Must not echo the raw SQL constraint text
    expect(body.error).not.toContain("duplicate key value");
    expect(body.error).not.toContain("unique constraint");
  });
});
