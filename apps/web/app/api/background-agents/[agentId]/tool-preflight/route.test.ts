/**
 * Tests for GET /api/background-agents/:agentId/tool-preflight (#802, epic #796 T6).
 *
 * Read-only dry-run endpoint: predicts per-toolkit availability for the
 * agent's NEXT run, without creating a Composio session or minting a token.
 *
 * BT-802-R001: requires authentication (401 when not signed in).
 * BT-802-R002: 404 for a missing/foreign agentId (not owned by this user).
 * BT-802-R003: 200 with typed { toolkits: [...] } for an agent with no
 *   toolkitSlugs configured — empty toolkits array (panel decides not to
 *   render, per the issue's "no toolkits configured" empty state).
 * BT-802-R004: 200 with per-slug predicted states composed from the agent's
 *   composioToolkitSlugs, delegating to computeAgentToolPreflight (the
 *   shared dry-run function) rather than reimplementing resolution.
 * BT-802-R005: upstream dry-run failure surfaces as a 5xx with a typed
 *   error body (distinct from a business-level composio_unreachable
 *   prediction for a specific toolkit).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

type MinimalAgent = {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  composioToolkitSlugs: string[];
} | null;

let ownedAgent: MinimalAgent = {
  id: "agent-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "widgets",
  composioToolkitSlugs: ["gmail", "linear"],
};

const getOwnedBackgroundAgentWithTriggers = mock(async () => ownedAgent);

type PreflightToolkitResult = {
  slug: string;
  predictedState: string;
  policyReason?: string;
  errorKind?: string;
};

let preflightResult: { toolkits: PreflightToolkitResult[] } = {
  toolkits: [
    { slug: "gmail", predictedState: "ready" },
    { slug: "linear", predictedState: "auth_expired" },
  ],
};
let preflightShouldThrow = false;

const computeAgentToolPreflight = mock(async () => {
  if (preflightShouldThrow) {
    throw new Error("Composio is unreachable");
  }
  return preflightResult;
});

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentWithTriggers,
}));

mock.module("@/lib/background-agents/tool-preflight", () => ({
  computeAgentToolPreflight,
}));

const routeModulePromise = import("./route");

function routeContext(agentId = "agent-1") {
  return { params: Promise.resolve({ agentId }) };
}

describe("GET /api/background-agents/:agentId/tool-preflight", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedAgent = {
      id: "agent-1",
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      composioToolkitSlugs: ["gmail", "linear"],
    };
    preflightResult = {
      toolkits: [
        { slug: "gmail", predictedState: "ready" },
        { slug: "linear", predictedState: "auth_expired" },
      ],
    };
    preflightShouldThrow = false;
    getOwnedBackgroundAgentWithTriggers.mockClear();
    computeAgentToolPreflight.mockClear();
  });

  test("BT-802-R001: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/agent-1/tool-preflight",
      ),
      routeContext(),
    );

    expect(response.status).toBe(401);
  });

  test("BT-802-R002: returns 404 for a missing/foreign agentId", async () => {
    ownedAgent = null;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/agent-missing/tool-preflight",
      ),
      routeContext("agent-missing"),
    );

    expect(response.status).toBe(404);
  });

  test("BT-802-R003: returns empty toolkits array when the agent has no toolkitSlugs configured", async () => {
    ownedAgent = {
      id: "agent-1",
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      composioToolkitSlugs: [],
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/agent-1/tool-preflight",
      ),
      routeContext(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { toolkits: PreflightToolkitResult[] };
    expect(body.toolkits).toEqual([]);
    // No dry-run call is needed for an empty slug list.
    expect(computeAgentToolPreflight).not.toHaveBeenCalled();
  });

  test("BT-802-R004: delegates to computeAgentToolPreflight with the agent's slugs and repo context", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/agent-1/tool-preflight",
      ),
      routeContext(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { toolkits: PreflightToolkitResult[] };
    expect(body.toolkits).toEqual([
      { slug: "gmail", predictedState: "ready" },
      { slug: "linear", predictedState: "auth_expired" },
    ]);
    expect(computeAgentToolPreflight).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail", "linear"],
      agentId: "agent-1",
    });
  });

  test("BT-802-R005: upstream dry-run failure surfaces as a 5xx typed error, not a silent 200", async () => {
    preflightShouldThrow = true;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/background-agents/agent-1/tool-preflight",
      ),
      routeContext(),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
