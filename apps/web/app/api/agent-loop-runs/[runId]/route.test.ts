/**
 * Tests for GET /api/agent-loop-runs/[runId] — the poll target
 * Written first (RED phase) — all tests fail before implementation.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoopEvent } from "@/lib/db/schema";

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

const eventsFixture: AgentLoopEvent[] = [
  {
    id: "event-1",
    loopRunId: "run-1",
    stepRunId: "step-1",
    nodeId: "s1",
    eventName: "agent-loop.run.started",
    status: "started",
    level: "info",
    summary: "Run started",
    payload: {},
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: null,
    createdAt: new Date("2024-01-01"),
  },
];

const getAgentLoopRunWithLoop = mock(
  async (): Promise<unknown> => runAndLoopFixture,
);
const listStepRunsForRun = mock(async () => stepRunsFixture);
const listAgentLoopEvents = mock(
  async (): Promise<AgentLoopEvent[]> => eventsFixture,
);
// M3-02-B: listWatchdogRunsForLoopRun is now called by route.ts
const listWatchdogRunsForLoopRun = mock(async () => []);

// #798 P2-2: uncapped, composio-scoped fetch — default empty so existing
// tests (which never assert on composio events) are unaffected.
const listAgentLoopComposioEvents = mock(
  async (): Promise<AgentLoopEvent[]> => [],
);

const isAgentLoopsEnabled = mock(() => true);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/agent-loops/store", () => ({
  getAgentLoopRunWithLoop,
  listStepRunsForRun,
  listAgentLoopEvents,
  listAgentLoopComposioEvents,
  listWatchdogRunsForLoopRun,
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
    listAgentLoopComposioEvents.mockClear();
    listAgentLoopComposioEvents.mockImplementation(async () => []);
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

  test("BT-040: retained owned run detail remains readable when execution is disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: { id: "run-1" },
      loop: { id: "loop-1" },
      steps: expect.any(Array),
      events: expect.any(Array),
    });
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

  test("returns retained evidence with loop:null after source deletion", async () => {
    getAgentLoopRunWithLoop.mockImplementation(async () => ({
      ...runAndLoopFixture,
      run: {
        ...runAndLoopFixture.run,
        loopId: null,
        status: "cancelled" as const,
        errorKind: "source_deleted",
      },
      loop: null,
    }));
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: { id: "run-1", loopId: null, errorKind: "source_deleted" },
      loop: null,
      steps: expect.any(Array),
      events: expect.any(Array),
      watchdogRuns: expect.any(Array),
    });
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

  // ---------------------------------------------------------------------------
  // Codex review (PR #824), P2-2: listAgentLoopEvents is a newest-200 slice.
  // agent-loop.step.composio.* events are emitted early in a step, so a
  // chatty run's newer events can push them out of that window. The route
  // must fetch composio-prefixed events explicitly (uncapped) and merge them
  // into the response's events[] so the run-detail page's
  // deriveLoopComposioWarnings(events) never silently loses them.
  // ---------------------------------------------------------------------------
  test("BT-045 (#798 P2-2): merges the uncapped composio-scoped fetch into events[], even when it's not in the capped slice", async () => {
    const offScreenComposioEvent = {
      id: "ev-composio-off",
      loopRunId: "run-1",
      stepRunId: "step-1",
      nodeId: "s1",
      eventName: "agent-loop.step.composio.off",
      status: "succeeded" as const,
      level: "warn" as const,
      summary: null,
      payload: { reason: "no_slugs_selected" },
      redactionStatus: "passed" as const,
      requestId: null,
      workflowRunId: null,
      createdAt: new Date("2023-01-01"), // older than the capped slice
    };
    listAgentLoopComposioEvents.mockImplementation(async () => [
      offScreenComposioEvent,
    ]);

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      (body.events as Array<{ id: string }>).some(
        (e) => e.id === "ev-composio-off",
      ),
    ).toBe(true);
    // The original capped-slice event must still be present too.
    expect(
      (body.events as Array<{ id: string }>).some((e) => e.id === "event-1"),
    ).toBe(true);
  });

  test("BT-046 (#798 P2-2): a composio event present in both the capped slice and the uncapped fetch is not duplicated", async () => {
    // eventsFixture's "event-1" is agent-loop.run.started (not composio),
    // so simulate an overlap explicitly.
    const overlapEvent = {
      id: "ev-overlap",
      loopRunId: "run-1",
      stepRunId: "step-1",
      nodeId: "s1",
      eventName: "agent-loop.step.composio.off",
      status: "succeeded" as const,
      level: "warn" as const,
      summary: null,
      payload: { reason: "no_slugs_selected" },
      redactionStatus: "passed" as const,
      requestId: null,
      workflowRunId: null,
      createdAt: new Date("2024-01-01"),
    };
    listAgentLoopEvents.mockImplementation(async () => [
      ...eventsFixture,
      overlapEvent,
    ]);
    listAgentLoopComposioEvents.mockImplementation(async () => [overlapEvent]);

    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    const body = await response.json();

    const matches = (body.events as Array<{ id: string }>).filter(
      (e) => e.id === "ev-overlap",
    );
    expect(matches.length).toBe(1);
  });
});
