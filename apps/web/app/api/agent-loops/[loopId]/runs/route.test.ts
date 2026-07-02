/**
 * Tests for POST /api/agent-loops/[loopId]/runs and GET /api/agent-loops/[loopId]/runs
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

type DispatchResult =
  | { skipped: false; created: boolean; runId: string }
  | {
      skipped: true;
      reason:
        | "feature_disabled"
        | "repo_not_allowed"
        | "loop_inactive"
        | "loop_invalid"
        | "active_run"
        | "ownership_fail";
    }
  | {
      dispatchFailed: true;
      errorKind: "dispatch_failed";
      errorMessage: string;
      runId: string;
    };

const dispatchManualAgentLoopStart = mock(
  async (): Promise<DispatchResult> => ({
    skipped: false as const,
    created: true,
    runId: "run-1",
  }),
);

const listAgentLoopRuns = mock(async () => [
  {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running",
    source: "manual",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
]);

const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/dispatcher-bridge", () => ({
  dispatchManualAgentLoopStart,
}));

mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoopRuns,
  updateAgentLoopRunContext: mock(async () => undefined),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  isAgentLoopRepoAllowed: mock(() => true),
}));

const routeModulePromise = import("./route");

function context(loopId = "loop-1") {
  return {
    params: Promise.resolve({ loopId }),
  };
}

describe("POST /api/agent-loops/[loopId]/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    dispatchManualAgentLoopStart.mockClear();
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: false as const,
      created: true,
      runId: "run-1",
    }));
  });

  test("BT-022: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(dispatchManualAgentLoopStart).not.toHaveBeenCalled();
  });

  test("BT-023: returns 403 when feature flag disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    // feature_disabled is returned by dispatcher too, but we check flag first
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: true as const,
      reason: "feature_disabled" as const,
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorKind: "feature_disabled" });
  });

  test("BT-024: dispatches manual start and returns 202 with runId", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ runId: "run-1" });
    expect(dispatchManualAgentLoopStart).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        loopId: "loop-1",
      }),
    );
  });

  test("BT-025: returns 409 with activeRunId when a run is already active", async () => {
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: true as const,
      reason: "active_run" as const,
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "active_run" });
  });

  test("BT-026: returns 404 for ownership failure (no existence leak)", async () => {
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: true as const,
      reason: "ownership_fail" as const,
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-999/runs", {
        method: "POST",
      }),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    // Must not be 403 — no existence leak
    expect(response.status).not.toBe(403);
  });

  test("BT-027: returns 409 when loop is inactive", async () => {
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: true as const,
      reason: "loop_inactive" as const,
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "loop_inactive" });
  });

  test("BT-028: returns 403 when repo is not allowlisted", async () => {
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      skipped: true as const,
      reason: "repo_not_allowed" as const,
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toMatchObject({ errorKind: "repo_not_allowed" });
  });

  test("BT-033: returns 502 with success:false, errorKind:dispatch_failed when initial dispatch fails (issue #763 — no false {created:true})", async () => {
    dispatchManualAgentLoopStart.mockImplementation(async () => ({
      dispatchFailed: true as const,
      errorKind: "dispatch_failed" as const,
      errorMessage: "Failed to dispatch start node step workflow: boom",
      runId: "run-1",
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/runs", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      success: false,
      errorKind: "dispatch_failed",
      runId: "run-1",
    });
  });
});

describe("GET /api/agent-loops/[loopId]/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    listAgentLoopRuns.mockClear();
    listAgentLoopRuns.mockImplementation(async () => [
      {
        id: "run-1",
        loopId: "loop-1",
        userId: "user-1",
        status: "running",
        source: "manual",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ]);
  });

  test("BT-029: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1/runs"),
      context(),
    );
    expect(response.status).toBe(401);
  });

  test("BT-030: returns run history for owned loop", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1/runs"),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ runs: [{ id: "run-1" }] });
    expect(listAgentLoopRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        loopId: "loop-1",
        userId: "user-1",
      }),
    );
  });

  test("BT-031: clamps limit param to 200", async () => {
    const { GET } = await routeModulePromise;
    await GET(
      new Request("http://localhost/api/agent-loops/loop-1/runs?limit=500"),
      context(),
    );
    expect(listAgentLoopRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 200, // clamped from 500
      }),
    );
  });

  test("BT-032: uses default limit when not specified", async () => {
    const { GET } = await routeModulePromise;
    await GET(
      new Request("http://localhost/api/agent-loops/loop-1/runs"),
      context(),
    );
    expect(listAgentLoopRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: expect.any(Number),
      }),
    );
  });
});
