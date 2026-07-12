/**
 * Route tests for watchdog surface — M3-02-B
 *
 * Behavior contract:
 *   BT-LOOPS-M3-02B-001: GET /api/agent-loop-runs/[runId] includes watchdogRuns[] in response
 *   BT-LOOPS-M3-02B-002: watchdogRuns fetched concurrently (same Promise.all as steps/events)
 *   BT-LOOPS-M3-02B-003: 403 (feature disabled) does NOT call listWatchdogRunsForLoopRun
 *   BT-LOOPS-M3-02B-004: 404 (not-owned run) does NOT call listWatchdogRunsForLoopRun
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
    status: "paused" as const,
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
    watchdogEnabled: true,
    watchdogInstructions: null,
    watchdogRetryBudget: 3,
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

const watchdogRunsFixture = [
  {
    id: "wd-1",
    loopRunId: "run-1",
    stepRunId: "step-1",
    nodeId: "s1",
    status: "decided" as const,
    decision: "pause" as const,
    diagnosis: "Step exceeded max retries without progress.",
    decisionPayload: null,
    attempt: 1,
    budgetRemaining: 2,
    startedAt: new Date("2024-01-01T00:01:00Z"),
    finishedAt: new Date("2024-01-01T00:01:10Z"),
    createdAt: new Date("2024-01-01T00:01:00Z"),
  },
];

const getAgentLoopRunWithLoop = mock(
  async (): Promise<typeof runAndLoopFixture | null> => runAndLoopFixture,
);
const listStepRunsForRun = mock(async () => stepRunsFixture);
const listAgentLoopEvents = mock(async () => eventsFixture);
// #798 P2-2: uncapped, composio-scoped fetch — default empty so existing
// tests (which never assert on composio events) are unaffected.
const listAgentLoopComposioEvents = mock(
  async () => [] as typeof eventsFixture,
);
const listWatchdogRunsForLoopRun = mock(async () => watchdogRunsFixture);

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

describe("GET /api/agent-loop-runs/[runId] — watchdog surface", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentLoopsEnabled.mockImplementation(() => true);
    getAgentLoopRunWithLoop.mockClear();
    getAgentLoopRunWithLoop.mockImplementation(async () => runAndLoopFixture);
    listStepRunsForRun.mockClear();
    listStepRunsForRun.mockImplementation(async () => stepRunsFixture);
    listAgentLoopEvents.mockClear();
    listAgentLoopEvents.mockImplementation(async () => eventsFixture);
    listWatchdogRunsForLoopRun.mockClear();
    listWatchdogRunsForLoopRun.mockImplementation(
      async () => watchdogRunsFixture,
    );
  });

  // BT-LOOPS-M3-02B-001: response includes watchdogRuns
  test("BT-LOOPS-M3-02B-001: response includes watchdogRuns[] from listWatchdogRunsForLoopRun", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.run.id).toBe("run-1");
    expect(Array.isArray(body.watchdogRuns)).toBe(true);
    expect(body.watchdogRuns.length).toBe(1);
    expect(body.watchdogRuns[0].id).toBe("wd-1");
    expect(body.watchdogRuns[0].decision).toBe("pause");
    expect(body.watchdogRuns[0].diagnosis).toBe(
      "Step exceeded max retries without progress.",
    );
  });

  // BT-LOOPS-M3-02B-002: watchdogRuns fetched (listWatchdogRunsForLoopRun called for owned runs)
  test("BT-LOOPS-M3-02B-002: calls listWatchdogRunsForLoopRun for owned authorized runs", async () => {
    const { GET } = await routeModulePromise;
    await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(listWatchdogRunsForLoopRun.mock.calls.length).toBe(1);
    // Use type assertion to access mock call args (bun mock type is untyped tuple)
    const firstCallArgs = listWatchdogRunsForLoopRun.mock
      .calls[0] as unknown as [string];
    expect(firstCallArgs[0]).toBe("run-1");
  });

  // BT-LOOPS-M3-02B-003: disabling new execution must not hide retained evidence.
  test("BT-LOOPS-M3-02B-003: keeps watchdog evidence readable when execution is disabled", async () => {
    isAgentLoopsEnabled.mockImplementation(() => false);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).watchdogRuns).toHaveLength(1);
    expect(listWatchdogRunsForLoopRun.mock.calls.length).toBe(1);
  });

  // BT-LOOPS-M3-02B-004: 404 (non-owned run) does NOT call listWatchdogRunsForLoopRun
  test("BT-LOOPS-M3-02B-004: does NOT call listWatchdogRunsForLoopRun for non-owned run (404)", async () => {
    getAgentLoopRunWithLoop.mockImplementation(async () => null);
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-999"),
      context("run-999"),
    );
    expect(response.status).toBe(404);
    expect(listWatchdogRunsForLoopRun.mock.calls.length).toBe(0);
  });

  // BT-LOOPS-M3-02B-005: 404 for wrong-user run also does NOT call listWatchdogRunsForLoopRun
  test("BT-LOOPS-M3-02B-005: does NOT call listWatchdogRunsForLoopRun for wrong-user run (404)", async () => {
    getAgentLoopRunWithLoop.mockImplementation(async () => ({
      ...runAndLoopFixture,
      run: { ...runAndLoopFixture.run, userId: "user-2" },
    }));
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/agent-loop-runs/run-1"),
      context(),
    );
    expect(response.status).toBe(404);
    expect(listWatchdogRunsForLoopRun.mock.calls.length).toBe(0);
  });
});
