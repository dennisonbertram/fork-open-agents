/**
 * Tests for POST /api/agent-loop-runs/[runId]/pause|resume|cancel|retry
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { RunControlError } from "@/lib/agent-loops/run-controls-error";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const pauseLoopRun = mock(async () => undefined);
const cancelLoopRun = mock(async () => undefined);
const resumeLoopRun = mock(async () => undefined);
const retryCurrentStep = mock(async () => undefined);

const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/run-controls", () => ({
  pauseLoopRun,
  cancelLoopRun,
  resumeLoopRun,
  retryCurrentStep,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
}));

// Lazy import the four control routes
const pauseRoutePromise = import("./pause/route");
const resumeRoutePromise = import("./resume/route");
const cancelRoutePromise = import("./cancel/route");
const retryRoutePromise = import("./retry/route");

function context(runId = "run-1") {
  return {
    params: Promise.resolve({ runId }),
  };
}

describe("POST /api/agent-loop-runs/[runId]/pause", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    pauseLoopRun.mockClear();
    pauseLoopRun.mockImplementation(async () => undefined);
  });

  test("BT-045: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(pauseLoopRun).not.toHaveBeenCalled();
  });

  test("BT-046: pauses run and returns 200", async () => {
    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(pauseLoopRun).toHaveBeenCalledWith("run-1", "user-1");
  });

  test("BT-047: returns 409 for illegal transition (run not in pausable status)", async () => {
    pauseLoopRun.mockImplementation(async () => {
      throw new RunControlError(
        "illegal_transition",
        "Cannot pause run run-1: not in a pausable status (running/queued)",
      );
    });
    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/pause", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "illegal_transition" });
  });

  test("BT-048: returns 404 for non-owned run (no existence leak)", async () => {
    pauseLoopRun.mockImplementation(async () => {
      throw new RunControlError("not_found", "Loop run not found: run-999");
    });
    const { POST } = await pauseRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-999/pause", {
        method: "POST",
      }),
      context("run-999"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/agent-loop-runs/[runId]/cancel", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    cancelLoopRun.mockClear();
    cancelLoopRun.mockImplementation(async () => undefined);
  });

  test("BT-049: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await cancelRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/cancel", {
        method: "POST",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(cancelLoopRun).not.toHaveBeenCalled();
  });

  test("BT-050: cancels run and returns 200", async () => {
    const { POST } = await cancelRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/cancel", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(cancelLoopRun).toHaveBeenCalledWith("run-1", "user-1");
  });

  test("BT-051: returns 409 for illegal transition (run not in cancellable status)", async () => {
    cancelLoopRun.mockImplementation(async () => {
      throw new RunControlError(
        "illegal_transition",
        "Cannot cancel run run-1: not in a cancellable status (running/queued/paused)",
      );
    });
    const { POST } = await cancelRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/cancel", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "illegal_transition" });
  });
});

describe("POST /api/agent-loop-runs/[runId]/resume", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    resumeLoopRun.mockClear();
    resumeLoopRun.mockImplementation(async () => undefined);
  });

  test("BT-052: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await resumeRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/resume", {
        method: "POST",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(resumeLoopRun).not.toHaveBeenCalled();
  });

  test("BT-053: resumes run and returns 200", async () => {
    const { POST } = await resumeRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/resume", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(resumeLoopRun).toHaveBeenCalledWith("run-1", "user-1");
  });

  test("BT-054: returns 409 for illegal transition (run not paused)", async () => {
    resumeLoopRun.mockImplementation(async () => {
      throw new RunControlError(
        "illegal_transition",
        "Cannot resume run run-1: not in paused status",
      );
    });
    const { POST } = await resumeRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/resume", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "illegal_transition" });
  });
});

describe("POST /api/agent-loop-runs/[runId]/retry", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    retryCurrentStep.mockClear();
    retryCurrentStep.mockImplementation(async () => undefined);
  });

  test("BT-055: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await retryRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/retry", {
        method: "POST",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(retryCurrentStep).not.toHaveBeenCalled();
  });

  test("BT-056: retries current step and returns 200", async () => {
    const { POST } = await retryRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/retry", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(retryCurrentStep).toHaveBeenCalledWith("run-1", "user-1");
  });

  test("BT-057: returns 409 for illegal transition (run not in retryable status)", async () => {
    retryCurrentStep.mockImplementation(async () => {
      throw new RunControlError(
        "illegal_transition",
        "Cannot retry run run-1: not in a retryable status (failed/stalled), got: running",
      );
    });
    const { POST } = await retryRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-1/retry", {
        method: "POST",
      }),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ errorKind: "illegal_transition" });
  });

  test("BT-058: returns 404 for non-owned run", async () => {
    retryCurrentStep.mockImplementation(async () => {
      throw new RunControlError("not_found", "Loop run not found: run-999");
    });
    const { POST } = await retryRoutePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loop-runs/run-999/retry", {
        method: "POST",
      }),
      context("run-999"),
    );
    expect(response.status).toBe(404);
  });
});
