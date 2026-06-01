import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

type OwnershipResult =
  | { ok: true; runId: string; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownershipResult: OwnershipResult = {
  ok: true,
  runId: "run-1",
  userId: "user-1",
};

type RunControlResult =
  | { ok: true; state: string }
  | { ok: false; error: string };

let applyRunControlCommandResult: RunControlResult = {
  ok: true,
  state: "pausing",
};

const requireAuthenticatedUserMock = mock(async () => authResult);
const requireOwnedWorkflowRunByRunIdMock = mock(async () => ownershipResult);
const applyRunControlCommandMock = mock(async () => applyRunControlCommandResult);

mock.module("@/app/api/chat/_lib/chat-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedWorkflowRunByRunId: requireOwnedWorkflowRunByRunIdMock,
}));

mock.module("@/lib/workflows/run-control", () => ({
  applyRunControlCommand: applyRunControlCommandMock,
}));

// Import route AFTER mocks
const routeModulePromise = import("./route");

function makeRequest(
  runId: string,
  body: Record<string, unknown> = {
    command: "pause",
    idempotencyKey: "idem-test-1",
  },
) {
  return new Request(
    `http://localhost/api/workflows/runs/${runId}/control`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(runId = "run-1") {
  return { params: Promise.resolve({ runId }) };
}

describe("POST /api/workflows/runs/[runId]/control", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownershipResult = { ok: true, runId: "run-1", userId: "user-1" };
    applyRunControlCommandResult = { ok: true, state: "pausing" };
    requireAuthenticatedUserMock.mockClear();
    requireOwnedWorkflowRunByRunIdMock.mockClear();
    applyRunControlCommandMock.mockClear();
  });

  test("unauthenticated request returns 401", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;
    const res = await POST(makeRequest("run-1"), context());

    expect(res.status).toBe(401);
    expect(requireOwnedWorkflowRunByRunIdMock).not.toHaveBeenCalled();
    expect(applyRunControlCommandMock).not.toHaveBeenCalled();
  });

  test("wrong owner returns 403", async () => {
    ownershipResult = {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
    const { POST } = await routeModulePromise;
    const res = await POST(makeRequest("run-1"), context());

    expect(res.status).toBe(403);
    expect(applyRunControlCommandMock).not.toHaveBeenCalled();
  });

  test("unknown runId returns 404", async () => {
    ownershipResult = {
      ok: false,
      response: Response.json({ error: "Run not found" }, { status: 404 }),
    };
    const { POST } = await routeModulePromise;
    const res = await POST(makeRequest("run-unknown"), context("run-unknown"));

    expect(res.status).toBe(404);
    expect(applyRunControlCommandMock).not.toHaveBeenCalled();
  });

  test("valid pause on running run returns 200 with state pausing", async () => {
    applyRunControlCommandResult = { ok: true, state: "pausing" };
    const { POST } = await routeModulePromise;
    const res = await POST(makeRequest("run-1"), context());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("pausing");
  });

  test("illegal transition returns 409 with error kind in body", async () => {
    applyRunControlCommandResult = {
      ok: false,
      error: "run_control_illegal_transition",
    };
    const { POST } = await routeModulePromise;
    const res = await POST(
      makeRequest("run-1", { command: "cancel", idempotencyKey: "idem-1" }),
      context(),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("run_control_illegal_transition");
  });

  test("conflicting command returns 409 with run_control_conflict in body", async () => {
    applyRunControlCommandResult = {
      ok: false,
      error: "run_control_conflict",
    };
    const { POST } = await routeModulePromise;
    const res = await POST(
      makeRequest("run-1", { command: "cancel", idempotencyKey: "idem-2" }),
      context(),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("run_control_conflict");
  });

  test("DB failure returns 500", async () => {
    applyRunControlCommandResult = {
      ok: false,
      error: "run_control_persist_failed",
    };
    const { POST } = await routeModulePromise;
    const res = await POST(makeRequest("run-1"), context());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("run_control_persist_failed");
  });

  test("invalid request body returns 400", async () => {
    const { POST } = await routeModulePromise;
    // Missing idempotencyKey
    const res = await POST(
      makeRequest("run-1", { command: "pause" }),
      context(),
    );

    expect(res.status).toBe(400);
    expect(applyRunControlCommandMock).not.toHaveBeenCalled();
  });
});
