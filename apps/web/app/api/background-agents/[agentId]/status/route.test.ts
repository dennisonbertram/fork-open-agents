/**
 * Tests for GET /api/background-agents/:agentId/status
 * TASK-167-gaps: BT-167-G2-005, BT-167-G2-006, BT-167-G2-007
 *
 * This route is used by AgentCard for lightweight polling when a run is active.
 * It returns only the latest run's non-sensitive status fields.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mocks — must be at top level for Bun's module mock hoisting
// ---------------------------------------------------------------------------

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

type MinimalRun = {
  id: string;
  agentId: string;
  status: string;
  outputUrl: string | null;
  errorKind: string | null;
  createdAt: Date;
};
let mockRuns: MinimalRun[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  listBackgroundAgentRuns: async () => mockRuns,
}));

// ---------------------------------------------------------------------------
// Route module import (after mocks)
// ---------------------------------------------------------------------------

const routeModulePromise = import("./route");

function routeContext(agentId = "agent-1") {
  return { params: Promise.resolve({ agentId }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/background-agents/:agentId/status", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    mockRuns = [];
  });

  test("BT-167-G2-005: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext(),
    );

    expect(response.status).toBe(401);
  });

  test("BT-167-G2-006: returns latest run status fields for an owned agent", async () => {
    mockRuns = [
      {
        id: "run-latest",
        agentId: "agent-1",
        status: "running",
        outputUrl: null,
        errorKind: null,
        createdAt: new Date("2026-06-01T12:00:00Z"),
      },
      {
        id: "run-older",
        agentId: "agent-1",
        status: "succeeded",
        outputUrl: "https://github.com/acme/widgets/pull/1",
        errorKind: null,
        createdAt: new Date("2026-06-01T11:00:00Z"),
      },
    ];

    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext("agent-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestRunId: string | null;
      latestRunStatus: string | null;
      latestOutputUrl: string | null;
    };
    // Returns the most recent run (sorted by createdAt desc)
    expect(body.latestRunId).toBe("run-latest");
    expect(body.latestRunStatus).toBe("running");
    // outputUrl from most recent run (null here — run is still active)
    expect(body.latestOutputUrl).toBeNull();
  });

  test("BT-167-G2-007: returns null fields when no runs exist for the agent", async () => {
    mockRuns = [];

    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agents/agent-1/status"),
      routeContext("agent-1"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestRunId: string | null;
      latestRunStatus: string | null;
      latestOutputUrl: string | null;
    };
    expect(body.latestRunId).toBeNull();
    expect(body.latestRunStatus).toBeNull();
    expect(body.latestOutputUrl).toBeNull();
  });
});
