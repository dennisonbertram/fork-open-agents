/**
 * Regression tests for agent-loop-run control routes (M1-08, TASK-327)
 *
 * These tests would fail if the control-plane implementation in 4cf7e709 were reverted.
 * They focus on: HTTP status codes for illegal transitions, no-existence-leak 404s,
 * and the flag-gate before any store mutation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const pauseLoopRun = mock(async () => undefined);
const cancelLoopRun = mock(async () => undefined);
const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/run-controls", () => ({
  pauseLoopRun,
  cancelLoopRun,
  resumeLoopRun: mock(async () => undefined),
  retryCurrentStep: mock(async () => undefined),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
  isAgentLoopRepoAllowed: mock(() => true),
}));

const pauseRoutePromise = import("./pause/route");
const cancelRoutePromise = import("./cancel/route");

function makeCtx(runId = "run-1") {
  return { params: Promise.resolve({ runId }) };
}

describe("Regression: pause control route", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    pauseLoopRun.mockClear();
    pauseLoopRun.mockImplementation(async () => undefined);
  });

  test("REG-007: illegal transition returns 409 with errorKind=illegal_transition", async () => {
    // Prevents the error mapper from returning a generic 500 for illegal transitions.
    pauseLoopRun.mockImplementation(async () => {
      throw new Error("Cannot pause run run-1: not in a pausable status");
    });

    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      makeCtx(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toHaveProperty("errorKind", "illegal_transition");
  });

  test("REG-008: not-found error returns 404 (no existence leak via 403)", async () => {
    // Prevents ownership mismatches from leaking a resource existence confirmation.
    pauseLoopRun.mockImplementation(async () => {
      throw new Error("Run run-999 not found");
    });

    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-999/pause", {
        method: "POST",
      }),
      makeCtx("run-999"),
    );

    expect(response.status).toBe(404);
    // Explicitly NOT a 403 — that would leak existence
    expect(response.status).not.toBe(403);
  });

  test("REG-009: feature flag check must precede store call", async () => {
    // Prevents the store being called before the flag gate.
    isAgentLoopsEnabled.mockImplementation(() => false);

    const { POST } = await pauseRoutePromise;
    await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      makeCtx(),
    );

    expect(pauseLoopRun).not.toHaveBeenCalled();
  });

  test("REG-010: successful pause returns 200 with JSON body (not 204 no-body)", async () => {
    // Prevents the success path from returning 204 no-body (breaking UI polling).
    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      makeCtx(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    // Body must be a parseable JSON object — UI depends on a body, not a 204
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });
});

describe("Regression: cancel control route", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    cancelLoopRun.mockClear();
    cancelLoopRun.mockImplementation(async () => undefined);
  });

  test("REG-011: cancel illegal transition returns 409", async () => {
    cancelLoopRun.mockImplementation(async () => {
      throw new Error("Cannot cancel run run-1: not in a cancellable status");
    });

    const { POST } = await cancelRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/cancel", {
        method: "POST",
      }),
      makeCtx(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toHaveProperty("errorKind", "illegal_transition");
  });

  test("REG-012: unauthenticated cancel is rejected before touching the store", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };

    const { POST } = await cancelRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/cancel", {
        method: "POST",
      }),
      makeCtx(),
    );

    expect(response.status).toBe(401);
    expect(cancelLoopRun).not.toHaveBeenCalled();
  });
});
