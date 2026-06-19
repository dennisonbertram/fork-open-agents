/**
 * Route tests for /api/settings/mcp-servers/[serverId]
 *
 * Regression coverage for two bugs caught in PR review:
 *
 * Bug A — transport reset: PATCH { enabled: false } must NOT inject transport
 *   into the update schema output, which would flip an SSE server to HTTP.
 *
 * Bug B — header secret destruction: PATCH without a headers field must NOT
 *   overwrite stored secrets. The route only passes headers to the store when
 *   the client explicitly includes them.
 *
 * Also covers:
 *   (1) Unauthenticated PATCH → 401
 *   (2) Unauthenticated DELETE → 401
 *   (3) PATCH enabled-only → 200, no transport written
 *   (4) PATCH with explicit headers → 200, headers forwarded
 *   (5) PATCH without headers → 200, headers NOT forwarded to store
 *   (6) PATCH unknown serverId → 404
 *   (7) DELETE existing → 200
 *   (8) DELETE unknown → 404
 *   (9) PATCH invalid body → 400 with fieldErrors
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpServerSummary } from "@/lib/mcp/store";
import type { UpdateMcpServerInput } from "@/lib/mcp/types";

// Allow server-only imports in test environment
mock.module("server-only", () => ({}));

// ─── mock state ───────────────────────────────────────────────────────────────

let authenticatedUser:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

// Capture the last call args for assertion
let lastUpdateCall: {
  userId: string;
  serverId: string;
  input: UpdateMcpServerInput;
} | null = null;
let updateReturnValue: McpServerSummary | null = null;
let deleteReturnValue = false;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
}));

const baseSummary: McpServerSummary = {
  id: "srv-1",
  name: "my-server",
  url: "https://mcp.example.com/mcp",
  transport: "sse",
  enabled: true,
  headerKeys: ["Authorization"],
  hasHeaders: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

mock.module("@/lib/mcp/store", () => ({
  updateMcpServer: async (
    userId: string,
    serverId: string,
    input: UpdateMcpServerInput,
  ): Promise<McpServerSummary | null> => {
    lastUpdateCall = { userId, serverId, input };
    return updateReturnValue;
  },
  deleteMcpServer: async (
    _userId: string,
    serverId: string,
  ): Promise<boolean> => {
    return serverId === "srv-1" ? deleteReturnValue : false;
  },
}));

const routeModulePromise = import("./route");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePatchRequest(serverId: string, body: unknown) {
  return new Request(`http://localhost/api/settings/mcp-servers/${serverId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(serverId: string) {
  return new Request(`http://localhost/api/settings/mcp-servers/${serverId}`, {
    method: "DELETE",
  });
}

function makeRouteContext(serverId: string) {
  return { params: Promise.resolve({ serverId }) };
}

// ─── reset state before each ─────────────────────────────────────────────────

beforeEach(() => {
  authenticatedUser = { ok: true, userId: "user-1" };
  lastUpdateCall = null;
  updateReturnValue = { ...baseSummary };
  deleteReturnValue = true;
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("PATCH /api/settings/mcp-servers/[serverId]", () => {
  test("(1) returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;
    const res = await PATCH(
      makePatchRequest("srv-1", { enabled: false }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(401);
  });

  test("(3) PATCH enabled-only → 200 and transport NOT in update input [regression: transport reset]", async () => {
    const { PATCH } = await routeModulePromise;
    const res = await PATCH(
      makePatchRequest("srv-1", { enabled: false }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(200);

    // The store must receive input without transport — not { transport: "http" }
    expect(lastUpdateCall).not.toBeNull();
    expect(lastUpdateCall!.input).not.toHaveProperty("transport");
    expect(lastUpdateCall!.input.enabled).toBe(false);
  });

  test("(5) PATCH without headers field → headers NOT forwarded to store [regression: secret destruction]", async () => {
    const { PATCH } = await routeModulePromise;
    // A rename-only PATCH — no headers key in body
    const res = await PATCH(
      makePatchRequest("srv-1", { name: "renamed-server" }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(200);

    // The store input must NOT contain a headers key
    expect(lastUpdateCall).not.toBeNull();
    expect(lastUpdateCall!.input).not.toHaveProperty("headers");
  });

  test("(4) PATCH with explicit headers → headers forwarded to store", async () => {
    const { PATCH } = await routeModulePromise;
    const res = await PATCH(
      makePatchRequest("srv-1", {
        headers: { Authorization: "Bearer newtoken" },
      }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(200);

    expect(lastUpdateCall).not.toBeNull();
    expect(lastUpdateCall!.input.headers).toEqual({
      Authorization: "Bearer newtoken",
    });
  });

  test("PATCH with headers: null → null forwarded (clear headers)", async () => {
    const { PATCH } = await routeModulePromise;
    const res = await PATCH(
      makePatchRequest("srv-1", { headers: null }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(200);

    expect(lastUpdateCall).not.toBeNull();
    expect(lastUpdateCall!.input.headers).toBeNull();
  });

  test("(6) PATCH unknown serverId → 404", async () => {
    updateReturnValue = null;
    const { PATCH } = await routeModulePromise;
    const res = await PATCH(
      makePatchRequest("no-such-id", { enabled: false }),
      makeRouteContext("no-such-id"),
    );
    expect(res.status).toBe(404);
  });

  test("(9) PATCH invalid body → 400 with fieldErrors", async () => {
    const { PATCH } = await routeModulePromise;
    // url must be a valid URL
    const res = await PATCH(
      makePatchRequest("srv-1", { url: "not-a-url" }),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { fieldErrors: Record<string, string[]> };
    };
    expect(body.details?.fieldErrors).toBeDefined();
    expect(Object.keys(body.details.fieldErrors)).toContain("url");
  });
});

describe("DELETE /api/settings/mcp-servers/[serverId]", () => {
  test("(2) returns 401 when unauthenticated", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { DELETE } = await routeModulePromise;
    const res = await DELETE(
      makeDeleteRequest("srv-1"),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(401);
  });

  test("(7) DELETE existing server → 200 ok", async () => {
    const { DELETE } = await routeModulePromise;
    const res = await DELETE(
      makeDeleteRequest("srv-1"),
      makeRouteContext("srv-1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("(8) DELETE unknown server → 404", async () => {
    const { DELETE } = await routeModulePromise;
    const res = await DELETE(
      makeDeleteRequest("unknown-srv"),
      makeRouteContext("unknown-srv"),
    );
    expect(res.status).toBe(404);
  });
});
