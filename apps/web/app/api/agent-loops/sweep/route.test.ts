/**
 * Tests for GET/POST /api/agent-loops/sweep
 *
 * BT-SW-R01: returns 500 when CRON_SECRET is not configured
 * BT-SW-R02: returns 401 without valid Bearer token
 * BT-SW-R03: returns 401 with wrong token
 * BT-SW-R04: GET with correct Bearer token runs sweep and returns 200 + counts
 * BT-SW-R05: POST with correct Bearer token also runs sweep and returns 200
 * BT-SW-R06: GET with correct x-background-agents-cron-secret header also authorized
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Sweep mock ─────────────────────────────────────────────────────────────────

const sweepStalledLoopRuns = mock(async () => ({
  stalledCount: 3,
  checkedCount: 10,
}));

mock.module("@/lib/agent-loops/sweep", () => ({
  sweepStalledLoopRuns,
}));

// ── Config mock ───────────────────────────────────────────────────────────────

let cronSecret: string | null = "test-secret-abc";
const getBackgroundAgentsCronSecret = mock(() => cronSecret);

mock.module("@/lib/background-agents/config", () => ({
  getBackgroundAgentsCronSecret,
}));

const routeModulePromise = import("./route");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agent-loops/sweep", () => {
  beforeEach(() => {
    cronSecret = "test-secret-abc";
    getBackgroundAgentsCronSecret.mockImplementation(() => cronSecret);
    sweepStalledLoopRuns.mockClear();
    sweepStalledLoopRuns.mockImplementation(async () => ({
      stalledCount: 3,
      checkedCount: 10,
    }));
  });

  test("BT-SW-R01: returns 500 when CRON_SECRET is not configured", async () => {
    cronSecret = null;
    getBackgroundAgentsCronSecret.mockImplementation(() => null);
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/agent-loops/sweep"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      error: expect.stringContaining("CRON_SECRET"),
    });
    expect(sweepStalledLoopRuns).not.toHaveBeenCalled();
  });

  test("BT-SW-R02: returns 401 without authorization header", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/agent-loops/sweep"),
    );

    expect(response.status).toBe(401);
    expect(sweepStalledLoopRuns).not.toHaveBeenCalled();
  });

  test("BT-SW-R03: returns 401 with wrong token", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/agent-loops/sweep", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(sweepStalledLoopRuns).not.toHaveBeenCalled();
  });

  test("BT-SW-R04: GET with correct Bearer token runs sweep and returns 200", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/agent-loops/sweep", {
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ stalledCount: 3, checkedCount: 10 });
    expect(sweepStalledLoopRuns).toHaveBeenCalledTimes(1);
  });

  test("BT-SW-R06: x-background-agents-cron-secret header also authorized", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/agent-loops/sweep", {
        headers: { "x-background-agents-cron-secret": "test-secret-abc" },
      }),
    );

    expect(response.status).toBe(200);
    expect(sweepStalledLoopRuns).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/agent-loops/sweep", () => {
  beforeEach(() => {
    cronSecret = "test-secret-abc";
    getBackgroundAgentsCronSecret.mockImplementation(() => cronSecret);
    sweepStalledLoopRuns.mockClear();
    sweepStalledLoopRuns.mockImplementation(async () => ({
      stalledCount: 1,
      checkedCount: 5,
    }));
  });

  test("BT-SW-R05: POST with correct Bearer token also runs sweep and returns 200", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/agent-loops/sweep", {
        method: "POST",
        headers: { authorization: "Bearer test-secret-abc" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ stalledCount: 1, checkedCount: 5 });
    expect(sweepStalledLoopRuns).toHaveBeenCalledTimes(1);
  });
});
