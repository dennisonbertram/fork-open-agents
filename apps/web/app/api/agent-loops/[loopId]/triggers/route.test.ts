/**
 * TDD RED tests for #762 — POST/GET /api/agent-loops/[loopId]/triggers
 *
 * Mirrors the auth/ownership pattern in ../route.test.ts:
 *   requireAuthenticatedUser() -> isAgentLoopsEnabled() -> loop ownership
 *   (getOwnedAgentLoop) -> store operation.
 *
 * BT-762-R1: requires authentication (401).
 * BT-762-R2: returns 403 when the feature flag is disabled.
 * BT-762-R3: returns 404 (not 403) for a loop the caller doesn't own.
 * BT-762-R4: POST creates a schedule trigger and seeds nextRunAt.
 * BT-762-R5: POST creates an event trigger.
 * BT-762-R6: POST returns 400 with errorKind trigger_invalid for bad input.
 * BT-762-R7: GET lists triggers with humanized schedule + nextRunAt.
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
const createLoopTrigger = mock(
  async (): Promise<BackgroundAgentTrigger> => triggerFixture,
);
const listTriggersForLoop = mock(
  async (): Promise<BackgroundAgentTrigger[]> => [triggerFixture],
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
  createLoopTrigger,
  listTriggersForLoop,
}));

const routeModulePromise = import("./route");

function context(loopId = "loop-1") {
  return { params: Promise.resolve({ loopId }) };
}

function postRequest(body: unknown, loopId = "loop-1") {
  return new Request(`http://localhost/api/agent-loops/${loopId}/triggers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent-loops/[loopId]/triggers", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockClear();
    isAgentLoopsEnabled.mockImplementation(() => true);
    getOwnedAgentLoop.mockClear();
    getOwnedAgentLoop.mockImplementation(async () => loopFixture);
    createLoopTrigger.mockClear();
    createLoopTrigger.mockImplementation(async () => triggerFixture);
  });

  test("BT-762-R1: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({
        name: "Nightly",
        kind: "schedule.cron",
        schedule: "0 2 * * *",
      }),
      context(),
    );
    expect(response.status).toBe(401);
    expect(createLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-R2: returns 403 when feature flag disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({
        name: "Nightly",
        kind: "schedule.cron",
        schedule: "0 2 * * *",
      }),
      context(),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.errorKind).toBe("feature_disabled");
  });

  test("BT-762-R3: returns 404 (not 403) for a loop the caller doesn't own", async () => {
    getOwnedAgentLoop.mockImplementation(async () => null);
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest(
        { name: "Nightly", kind: "schedule.cron", schedule: "0 2 * * *" },
        "loop-999",
      ),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(createLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-R4: creates a schedule trigger, seeds nextRunAt, returns 201", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({
        name: "Nightly",
        kind: "schedule.cron",
        schedule: "0 2 * * *",
      }),
      context(),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.trigger).toMatchObject({
      id: "trigger-1",
      kind: "schedule.cron",
      loopId: "loop-1",
    });
    expect(body.trigger.nextRunAt).toBeTruthy();
    expect(createLoopTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        loopId: "loop-1",
        userId: "user-1",
        input: expect.objectContaining({
          name: "Nightly",
          kind: "schedule.cron",
          schedule: "0 2 * * *",
        }),
      }),
    );
  });

  test("BT-762-R5: creates an event trigger", async () => {
    createLoopTrigger.mockImplementation(async () => ({
      ...triggerFixture,
      kind: "github.pull_request" as const,
      schedule: null,
      nextRunAt: null,
      conditions: { actions: ["opened"] },
    }));
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({
        name: "On PR opened",
        kind: "github.pull_request",
        conditions: { actions: ["opened"] },
      }),
      context(),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.trigger.kind).toBe("github.pull_request");
  });

  test("BT-762-R6: returns 400 with errorKind trigger_invalid for bad input", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({ name: "Bad", kind: "schedule.cron", schedule: "garbage" }),
      context(),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errorKind).toBe("trigger_invalid");
    expect(createLoopTrigger).not.toHaveBeenCalled();
  });

  test("BT-762-R6b: returns 400 for an unparseable JSON body", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(
      new Request("http://localhost/api/agent-loops/loop-1/triggers", {
        method: "POST",
        body: "not json",
      }),
      context(),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/agent-loops/[loopId]/triggers", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockClear();
    isAgentLoopsEnabled.mockImplementation(() => true);
    getOwnedAgentLoop.mockClear();
    getOwnedAgentLoop.mockImplementation(async () => loopFixture);
    listTriggersForLoop.mockClear();
    listTriggersForLoop.mockImplementation(async () => [triggerFixture]);
  });

  test("BT-762-R1b: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1/triggers"),
      context(),
    );
    expect(response.status).toBe(401);
  });

  test("BT-762-R3b: returns 404 for a loop the caller doesn't own", async () => {
    getOwnedAgentLoop.mockImplementation(async () => null);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-999/triggers"),
      context("loop-999"),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  test("BT-762-R7: lists triggers with humanized schedule + nextRunAt", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loops/loop-1/triggers"),
      context(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.triggers).toHaveLength(1);
    expect(body.triggers[0]).toMatchObject({
      id: "trigger-1",
      kind: "schedule.cron",
    });
    expect(body.triggers[0].nextRunAt).toBeTruthy();
    expect(typeof body.triggers[0].humanizedSchedule).toBe("string");
    expect(body.triggers[0].humanizedSchedule.length).toBeGreaterThan(0);
  });
});
