/**
 * Regression tests for agent-loops API routes (M1-08, TASK-327)
 *
 * These tests would fail if the implementation in commit 4cf7e709 were reverted.
 * They cover different angles than the behavioral tests: edge-cases, cross-route
 * invariants, and security properties that must never regress.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

// ---------- shared mocks ---------------------------------------------------

const createAgentLoop = mock(async () => ({
  ok: true as const,
  loop: {
    id: "loop-1",
    userId: "user-1",
    name: "Regression Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: { nodes: [], edges: [] },
    status: "draft" as const,
    guardrails: null,
    permissions: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
}));

const listAgentLoops = mock(async () => []);
const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/store", () => ({
  createAgentLoop,
  listAgentLoops,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  isAgentLoopRepoAllowed: mock(() => true),
}));

const routeModulePromise = import("./route");

// ---------- regression tests ------------------------------------------------

describe("Regression: POST /api/agent-loops", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    createAgentLoop.mockClear();
    createAgentLoop.mockImplementation(async () => ({
      ok: true as const,
      loop: {
        id: "loop-99",
        userId: "user-1",
        name: "Regression Loop",
        description: null,
        repoOwner: "acme",
        repoName: "widgets",
        definition: { nodes: [], edges: [] },
        status: "draft" as const,
        guardrails: null,
        permissions: {},
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    }));
  });

  test("REG-001: 403 body must contain errorKind=feature_disabled (shape contract for UI)", async () => {
    // Prevents the UI from receiving a generic 403 that it cannot interpret.
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: {},
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    // Exact field shape the M1-09 UI depends on
    expect(body).toHaveProperty("errorKind", "feature_disabled");
  });

  test("REG-002: 201 response includes loop.id and loop.name (shape contract for UI)", async () => {
    // Prevents the route from returning a 201 with a bare loop-id or no data.
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "Regression Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: { nodes: [], edges: [] },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toHaveProperty("loop");
    expect(body.loop).toHaveProperty("id", "loop-99");
    expect(body.loop).toHaveProperty("name", "Regression Loop");
  });

  test("REG-003: empty string name is rejected (schema min(1) constraint)", async () => {
    // Prevents a regression where the Zod schema's min(1) is removed.
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "",
          repoOwner: "acme",
          repoName: "widgets",
          definition: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createAgentLoop).not.toHaveBeenCalled();
  });

  test("REG-004: store is not called when unauthenticated (auth gate must come first)", async () => {
    // Prevents auth gate being bypassed if route logic is reordered.
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: {},
        }),
      }),
    );

    expect(createAgentLoop).not.toHaveBeenCalled();
  });
});

describe("Regression: GET /api/agent-loops", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    listAgentLoops.mockClear();
    listAgentLoops.mockImplementation(async () => []);
  });

  test("REG-005: user-id is threaded to listAgentLoops (ownership isolation)", async () => {
    // Prevents the route from listing all loops regardless of userId.
    const { GET } = await routeModulePromise;

    await GET(new Request("http://localhost/api/agent-loops"));

    // Must receive the authenticated user-id as the first arg — not undefined or a different id
    expect(listAgentLoops).toHaveBeenCalledWith("user-1", undefined);
  });

  test("REG-006: repoOwner without repoName is ignored (partial filter must not silently apply)", async () => {
    // If only repoOwner is present without repoName, the filter must be undefined
    // (not partially applied), preventing incorrect DB queries.
    const { GET } = await routeModulePromise;

    await GET(new Request("http://localhost/api/agent-loops?repoOwner=acme"));

    // Called with undefined filter — partial filter must not be forwarded
    expect(listAgentLoops).toHaveBeenCalledWith("user-1", undefined);
  });
});
