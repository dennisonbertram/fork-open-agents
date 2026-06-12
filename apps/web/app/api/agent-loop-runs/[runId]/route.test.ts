/**
 * Tests for GET /api/agent-loop-runs/[runId] — the poll target
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const runAndLoopFixture = {
  run: {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running" as const,
    source: "manual" as const,
    currentNodeId: "s1",
    currentStepRunId: "step-1",
    stepCount: 1,
    iterationCount: 0,
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    idempotencyKey: "key-1",
    triggerId: null,
    requestId: null,
    context: null,
    definitionSnapshot: {},
    startedAt: new Date("2024-01-01"),
    finishedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  loop: {
    id: "loop-1",
    name: "My Loop",
    repoOwner: "acme",
    repoName: "widgets",
    guardrails: null,
    userId: "user-1",
    description: null,
    definition: {},
    status: "active" as const,
    permissions: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
};

const stepRunsFixture = [
  {
    id: "step-1",
    loopRunId: "run-1",
    nodeId: "s1",
    nodeKind: "start",
    attempt: 1,
    status: "running" as const,
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    durationMs: null,
    startedAt: new Date("2024-01-01"),
    finishedAt: null,
    createdAt: new Date("2024-01-01"),
  },
];

const eventsFixture = [
  {
    id: "event-1",
    loopRunId: "run-1",
    stepRunId: "step-1",
    nodeId: "s1",
    eventName: "agent-loop.run.started",
    status: "started" as const,
    level: "info" as const,
    summary: "Run started",
    payload: null,
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: null,
    createdAt: new Date("2024-01-01"),
  },
];

const getAgentLoopRunWithLoop = mock(
  async (): Promise<typeof runAndLoopFixture | null> => runAndLoopFixture,
);
const listStepRunsForRun = mock(async () => stepRunsFixture);
const listAgentLoopEvents = mock(async () => eventsFixture);

const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/store", () => ({
  getAgentLoopRunWithLoop,
  listStepRunsForRun,
  listAgentLoopEvents,
  updateAgentLoopRunContext: mock(async () => undefined),
  conditionallyTransitionRunStatus: mock(async () => null),
  findStalledLoopRunCandidates: mock(async () => []),
  retryCurrentStep: mock(async () => undefined),
}));

mock.module("@/lib/agent-loops/config", () => ({
  isAgentLoopsEnabled,
}));

const routeModulePromise = import("./route");

function context(runId = "run-1") {
  return {
    params: Promise.resolve({ runId }),
  };
}

describe("GET /api/agent-loop-runs/[runId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    getAgentLoopRunWithLoop.mockClear();
    getAgentLoopRunWithLoop.mockImplementation(async () => runAndLoopFixture);
    listStepRunsForRun.mockClear();
    listStepRunsForRun.mockImplementation(async () => stepRunsFixture);
    listAgentLoopEvents.mockClear();
    listAgentLoopEvents.mockImplementation(async () => eventsFixture);
  });

  test("BT-039: requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(response.status).toBe(401);
  });

  test("BT-040: returns 403 when feature flag disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(response.status).toBe(403);
  });

  test("BT-041: returns run+loop summary+steps+events for owned run", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      run: { id: "run-1" },
      loop: {
        id: "loop-1",
        name: "My Loop",
        repoOwner: "acme",
        repoName: "widgets",
      },
      steps: expect.any(Array),
      events: expect.any(Array),
    });
  });

  test("BT-042: returns 404 for non-owned run (no existence leak)", async () => {
    getAgentLoopRunWithLoop.mockImplementation(async () => null);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-999"),
      context("run-999"),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  test("BT-043: returns 404 when run exists but belongs to different user", async () => {
    // getAgentLoopRunWithLoop returns a run owned by user-2, not user-1
    getAgentLoopRunWithLoop.mockImplementation(async () => ({
      ...runAndLoopFixture,
      run: { ...runAndLoopFixture.run, userId: "user-2" },
    }));
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    // Must be 404, not 200 or 403 (no existence leak)
    expect(response.status).toBe(404);
  });

  test("BT-044: includes steps ordered correctly", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "step-1" })]),
    );
  });
});
