/**
 * TDD RED tests for #762 — PATCH/DELETE
 * /api/agent-loops/[loopId]/triggers/[triggerId]
 *
 * BT-762-T1: requires authentication (401).
 * BT-762-T2: returns 403 when the feature flag is disabled.
 * BT-762-T3: returns 404 (not 403) for a loop the caller doesn't own.
 * BT-762-T4: PATCH updates trigger status (enable/disable).
 * BT-762-T5: PATCH returns 404 when the trigger doesn't belong to the loop.
 * BT-762-T6: PATCH returns 400 with errorKind trigger_invalid for bad input.
 * BT-762-T7: DELETE removes the trigger and returns success.
 * BT-762-T8: DELETE returns 404 when the trigger doesn't belong to the loop.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentTrigger } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const loopFixture = {
  id: "loop-1",
  userId: "user-1",
  name: "My Loop",
  status: "active" as const,
  repoOwner: "acme",
  repoName: "widgets",
};

const triggerFixture: BackgroundAgentTrigger = {
  id: "trigger-1",
  agentId: null,
  loopId: "loop-1",
  userId: "user-1",
  name: "Nightly",
  kind: "schedule.cron",
  status: "enabled",
  conditions: {},
  schedule: "0 2 * * *",
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: new Date("2026-01-02T02:00:00Z"),
  lastSkipReason: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const getOwnedAgentLoop = mock(
  async () => loopFixture as typeof loopFixture | null,
);
const isAgentLoopsEnabled = mock(() => true);
const updateLoopTrigger = mock(
  async (): Promise<BackgroundAgentTrigger | null> => triggerFixture,
);
const deleteLoopTrigger = mock(async () => true);
const getOwnedLoopTrigger = mock(
  async (): Promise<BackgroundAgentTrigger | null> => triggerFixture,
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/store", () => ({
  getOwnedAgentLoop,
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
}));

mock.module("@/lib/background-agents/store", () => ({
  updateLoopTrigger,
  deleteLoopTrigger,
  getOwnedLoopTrigger,
}));

const routeModulePromise = import("./route");

function context(loopId = "loop-1", triggerId = "trigger-1") {
  return { params: Promise.resolve({ loopId, triggerId }) };
}

function patchRequest(
  body: unknown,
  loopId = "loop-1",
  triggerId = "trigger-1",
) {
  return new Request(
    `http://localhost/api/agent-loops/${loopId}/triggers/${triggerId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function deleteRequest(loopId = "loop-1", triggerId = "trigger-1") {
  return new Request(
    `http://localhost/api/agent-loops/${loopId}/triggers/${triggerId}`,
    { method: "DELETE" },
  );
}

describe("PATCH /api/agent-loops/[loopId]/triggers/[triggerId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockClear();
    isAgentLoopsEnabled.mockImplementation(() => true);
    getOwnedAgentLoop.mockClear();
    getOwnedAgentLoop.mockImplementation(async () => loopFixture);
    updateLoopTrigger.mockClear();
    updateLoopTrigger.mockImplementation(async () => triggerFixture);
    getOwnedLoopTrigger.mockClear();
    getOwnedLoopTrigger.mockImplementation(async () => triggerFixture);
  });

  test("BT-762-T1: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ status: "disabled" }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(updateLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-T2: returns 403 when feature flag disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ status: "disabled" }),
      context(),
    );
    expect(response.status).toBe(403);
  });

  test("BT-762-T3: returns 404 (not 403) for a loop the caller doesn't own", async () => {
    getOwnedAgentLoop.mockImplementation(async () => null);
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ status: "disabled" }, "loop-999"),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(updateLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-T4: updates trigger status and returns 200", async () => {
    updateLoopTrigger.mockImplementation(async () => ({
      ...triggerFixture,
      status: "disabled" as const,
    }));
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ status: "disabled" }),
      context(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.trigger.status).toBe("disabled");
    expect(updateLoopTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        loopId: "loop-1",
        triggerId: "trigger-1",
        input: expect.objectContaining({ status: "disabled" }),
      }),
    );
  });

  test("BT-762-T8: rejects clearing the schedule on a schedule.cron trigger (400, no update)", async () => {
    // triggerFixture.kind is "schedule.cron" — clearing its schedule would
    // persist a schedule trigger with schedule:null / nextRunAt:null that can
    // never fire (Codex finding on PR #773).
    const { PATCH } = await routeModulePromise;
    for (const cleared of [null, ""]) {
      updateLoopTrigger.mockClear();
      const response = await PATCH(
        patchRequest({ schedule: cleared }),
        context(),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errorKind).toBe("trigger_invalid");
      expect(updateLoopTrigger).not.toHaveBeenCalled();
    }
  });

  test("BT-762-T9: clearing schedule on an event-kind trigger is not blocked by the cron guard", async () => {
    getOwnedLoopTrigger.mockImplementation(async () => ({
      ...triggerFixture,
      kind: "github.pull_request" as const,
      schedule: null,
      nextRunAt: null,
    }));
    updateLoopTrigger.mockImplementation(async () => ({
      ...triggerFixture,
      kind: "github.pull_request" as const,
      schedule: null,
      nextRunAt: null,
    }));
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(patchRequest({ schedule: null }), context());
    expect(response.status).toBe(200);
  });

  test("BT-762-T5: returns 404 when the trigger doesn't belong to the loop", async () => {
    updateLoopTrigger.mockImplementation(async () => null);
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ status: "disabled" }),
      context(),
    );
    expect(response.status).toBe(404);
  });

  test("BT-762-T6: returns 400 with errorKind trigger_invalid for bad input", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      patchRequest({ schedule: "garbage" }),
      context(),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errorKind).toBe("trigger_invalid");
    expect(updateLoopTrigger).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/agent-loops/[loopId]/triggers/[triggerId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockClear();
    isAgentLoopsEnabled.mockImplementation(() => true);
    getOwnedAgentLoop.mockClear();
    getOwnedAgentLoop.mockImplementation(async () => loopFixture);
    deleteLoopTrigger.mockClear();
    deleteLoopTrigger.mockImplementation(async () => true);
    getOwnedLoopTrigger.mockClear();
    getOwnedLoopTrigger.mockImplementation(async () => triggerFixture);
  });

  test("BT-762-T1b: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(401);
    expect(deleteLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-T3b: returns 404 (not 403) for a loop the caller doesn't own", async () => {
    getOwnedAgentLoop.mockImplementation(async () => null);
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      deleteRequest("loop-999"),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(deleteLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-T7: deletes the trigger and returns success", async () => {
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });
    expect(deleteLoopTrigger).toHaveBeenCalledWith({
      loopId: "loop-1",
      triggerId: "trigger-1",
    });
  });

  test("BT-762-T8: returns 404 when the trigger doesn't belong to the loop", async () => {
    deleteLoopTrigger.mockImplementation(async () => false);
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(deleteRequest(), context());
    expect(response.status).toBe(404);
  });
});
