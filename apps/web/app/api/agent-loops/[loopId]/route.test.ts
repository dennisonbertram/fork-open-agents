/**
 * Tests for GET/PATCH/DELETE /api/agent-loops/[loopId]
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const loopFixture = {
  id: "loop-1",
  userId: "user-1",
  name: "My Loop",
  description: null,
  repoOwner: "acme",
  repoName: "widgets",
  definition: {
    nodes: [
      { id: "s1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      { id: "e1", kind: "end", label: "End", position: { x: 100, y: 0 } },
    ],
    edges: [{ id: "edge-1", source: "s1", target: "e1", when: "always" }],
  },
  status: "active" as const,
  guardrails: null,
  permissions: {},
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const getOwnedAgentLoop = mock(
  async () => loopFixture as typeof loopFixture | null,
);
const updateAgentLoop = mock(
  async (): Promise<
    | { ok: true; loop: (typeof loopFixture & { name: string }) | null }
    | {
        ok: false;
        errors: { kind: "loop_invalid"; rule: string; message: string }[];
      }
  > => ({
    ok: true as const,
    loop: { ...loopFixture, name: "Updated Loop" },
  }),
);
const deleteAgentLoop = mock(async (): Promise<boolean> => true);

// Trigger summary stub
const listTriggersForLoop = mock(async () => []);

const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

// The route imports AgentLoopArchivedError to translate it into a 409, so the
// mock must export it too — otherwise every test in this file dies at import
// with "Export named 'AgentLoopArchivedError' not found".
class AgentLoopArchivedError extends Error {
  readonly kind = "conflict" as const;
  constructor() {
    super(
      "Archived agent loop definitions cannot be changed. Un-archive the loop before editing its definition.",
    );
    this.name = "AgentLoopArchivedError";
  }
}

mock.module("@/lib/agent-loops/store", () => ({
  AgentLoopArchivedError,
  getOwnedAgentLoop,
  updateAgentLoop,
  deleteAgentLoop,
  updateAgentLoopRunContext: mock(async () => undefined),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  isAgentLoopRepoAllowed: mock(() => true),
  getAgentLoopsAllowedRepos: mock(() => null),
  getAgentLoopsStallMinutes: mock(() => 15),
}));

mock.module("@/lib/background-agents/store", () => ({
  listTriggersForLoop,
}));

const routeModulePromise = import("./route");

function context(loopId = "loop-1") {
  return {
    params: Promise.resolve({ loopId }),
  };
}

describe("GET /api/agent-loops/[loopId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    getOwnedAgentLoop.mockClear();
    getOwnedAgentLoop.mockImplementation(async () => loopFixture);
    listTriggersForLoop.mockClear();
    listTriggersForLoop.mockImplementation(async () => []);
  });

  test("BT-011: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1"),
      context(),
    );
    expect(response.status).toBe(401);
  });

  test("BT-012: returns 403 when feature flag disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1"),
      context(),
    );
    expect(response.status).toBe(403);
  });

  test("BT-013: returns loop with trigger summary for owned loop", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1"),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      loop: { id: "loop-1", name: "My Loop" },
      triggers: expect.any(Array),
    });
  });

  test("BT-014: returns 404 for non-owned loop (no existence leak)", async () => {
    getOwnedAgentLoop.mockImplementation(async () => null);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-999"),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    // No 403 — no existence leak
    expect(response.status).not.toBe(403);
  });
});

describe("PATCH /api/agent-loops/[loopId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    updateAgentLoop.mockClear();
    updateAgentLoop.mockImplementation(async () => ({
      ok: true as const,
      loop: { ...loopFixture, name: "Updated Loop" },
    }));
  });

  test("BT-015: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/agent-loops/loop-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated" }),
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(updateAgentLoop).not.toHaveBeenCalled();
  });

  test("BT-016: returns 404 for non-owned loop", async () => {
    updateAgentLoop.mockImplementation(async () => ({
      ok: true as const,
      loop: null,
    }));
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/agent-loops/loop-999", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated" }),
      }),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
  });

  test("BT-017: updates loop and returns 200", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/agent-loops/loop-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Loop" }),
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ loop: { name: "Updated Loop" } });
    expect(updateAgentLoop).toHaveBeenCalledWith("user-1", "loop-1", {
      name: "Updated Loop",
    });
  });

  test("BT-018: returns 400 with structured errors on invalid definition", async () => {
    updateAgentLoop.mockImplementation(async () => ({
      ok: false as const,
      errors: [
        {
          kind: "loop_invalid" as const,
          rule: "no_start" as const,
          message: "No start node",
        },
      ],
    }));
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/agent-loops/loop-1", {
        method: "PATCH",
        body: JSON.stringify({ definition: { nodes: [], edges: [] } }),
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      errorKind: "loop_invalid",
      errors: expect.arrayContaining([
        expect.objectContaining({ kind: "loop_invalid" }),
      ]),
    });
  });
});

describe("DELETE /api/agent-loops/[loopId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    deleteAgentLoop.mockClear();
    deleteAgentLoop.mockImplementation(async () => true);
  });

  test("BT-019: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      new Request("http://localhost/api/agent-loops/loop-1", {
        method: "DELETE",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(deleteAgentLoop).not.toHaveBeenCalled();
  });

  test("BT-020: deletes loop and returns 200 success", async () => {
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      new Request("http://localhost/api/agent-loops/loop-1", {
        method: "DELETE",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(deleteAgentLoop).toHaveBeenCalledWith("user-1", "loop-1");
  });

  test("BT-021: returns 404 for non-owned loop", async () => {
    deleteAgentLoop.mockImplementation(async () => false);
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      new Request("http://localhost/api/agent-loops/loop-999", {
        method: "DELETE",
      }),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
  });
});
