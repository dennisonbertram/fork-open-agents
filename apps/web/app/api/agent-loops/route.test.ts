/**
 * Tests for POST /api/agent-loops and GET /api/agent-loops
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

type LoopRecord = {
  id: string;
  userId: string;
  name: string;
  description: null;
  repoOwner: string;
  repoName: string;
  definition: Record<string, unknown>;
  status: string;
  guardrails: null;
  permissions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type CreateResult =
  | { ok: true; loop: LoopRecord }
  | { ok: false; errors: { kind: string; rule: string; message: string }[] };

// Store mocks
const createAgentLoop = mock(
  async (): Promise<CreateResult> => ({
    ok: true as const,
    loop: {
      id: "loop-1",
      userId: "user-1",
      name: "My Loop",
      description: null,
      repoOwner: "acme",
      repoName: "widgets",
      definition: { nodes: [], edges: [] },
      status: "draft",
      guardrails: null,
      permissions: {},
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
  }),
);

const listAgentLoops = mock(async () => [
  {
    id: "loop-1",
    userId: "user-1",
    name: "My Loop",
    status: "active",
    repoOwner: "acme",
    repoName: "widgets",
  },
]);

// Config mock
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

// A minimal valid loop definition for tests
const validDefinition = {
  nodes: [
    { id: "s1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "e1", kind: "end", label: "End", position: { x: 100, y: 0 } },
  ],
  edges: [{ id: "edge-1", source: "s1", target: "e1", when: "always" }],
};

describe("POST /api/agent-loops", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    createAgentLoop.mockClear();
    createAgentLoop.mockImplementation(async () => ({
      ok: true as const,
      loop: {
        id: "loop-1",
        userId: "user-1",
        name: "My Loop",
        description: null,
        repoOwner: "acme",
        repoName: "widgets",
        definition: validDefinition,
        status: "draft" as const,
        guardrails: null,
        permissions: {},
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    }));
  });

  test("BT-001: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: validDefinition,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(createAgentLoop).not.toHaveBeenCalled();
  });

  test("BT-002: returns 403 when feature flag is disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: validDefinition,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorKind: "feature_disabled" });
    expect(createAgentLoop).not.toHaveBeenCalled();
  });

  test("BT-003: creates loop and returns 201 with loop", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: validDefinition,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ loop: { id: "loop-1", name: "My Loop" } });
    expect(createAgentLoop).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        name: "My Loop",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );
  });

  test("BT-004: returns 400 with structured errors on invalid definition", async () => {
    createAgentLoop.mockImplementation(async () => ({
      ok: false as const,
      errors: [
        {
          kind: "loop_invalid" as const,
          rule: "no_start" as const,
          message:
            "Loop definition must have exactly one start node; found none.",
        },
      ],
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({
          name: "My Loop",
          repoOwner: "acme",
          repoName: "widgets",
          definition: { nodes: [], edges: [] },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      errorKind: "loop_invalid",
      errors: expect.arrayContaining([
        expect.objectContaining({ kind: "loop_invalid", rule: "no_start" }),
      ]),
    });
  });

  test("BT-005: returns 400 on invalid JSON body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
  });

  test("BT-006: returns 400 when required fields are missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops", {
        method: "POST",
        body: JSON.stringify({ name: "Loop" }), // missing repoOwner, repoName, definition
      }),
    );

    expect(response.status).toBe(400);
    expect(createAgentLoop).not.toHaveBeenCalled();
  });
});

describe("GET /api/agent-loops", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    listAgentLoops.mockClear();
    listAgentLoops.mockImplementation(async () => [
      {
        id: "loop-1",
        userId: "user-1",
        name: "My Loop",
        status: "active",
        repoOwner: "acme",
        repoName: "widgets",
      },
    ]);
  });

  test("BT-007: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost/api/agent-loops"));

    expect(response.status).toBe(401);
  });

  test("BT-008: returns 403 when feature flag is disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost/api/agent-loops"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorKind: "feature_disabled" });
  });

  test("BT-009: lists owned loops for authenticated user", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost/api/agent-loops"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ loops: [{ id: "loop-1" }] });
    expect(listAgentLoops).toHaveBeenCalledWith("user-1", undefined);
  });

  test("BT-010: filters by repoOwner/repoName when provided", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/agent-loops?repoOwner=acme&repoName=widgets",
      ),
    );

    expect(response.status).toBe(200);
    expect(listAgentLoops).toHaveBeenCalledWith("user-1", {
      repoOwner: "acme",
      repoName: "widgets",
    });
  });
});
