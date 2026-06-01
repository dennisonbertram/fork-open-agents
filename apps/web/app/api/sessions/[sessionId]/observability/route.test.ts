import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkflowGoal, WorkflowGoalEvent } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Auth mocks
// ---------------------------------------------------------------------------

const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));

const requireOwnedSessionMock = mock(async () => ({
  ok: true as const,
  sessionRecord: {
    id: "session-1",
    userId: "user-1",
    runtimeMode: "classic" as const,
  },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSession: requireOwnedSessionMock,
}));

// ---------------------------------------------------------------------------
// Database mocks: existing observability data sources
// ---------------------------------------------------------------------------

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      workflowRuns: {
        findMany: mock(async () => []),
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        }),
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
  },
}));

mock.module("@/lib/observability/events", () => ({
  listSessionEvents: mock(async () => []),
  toSessionEventSnapshot: mock((e: unknown) => e),
}));

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  listManagedRuntimeProfileRuns: mock(async () => []),
  toManagedRuntimeProfileRunSnapshot: mock((r: unknown) => r),
}));

mock.module("@/lib/observability/managed-runtime-workers", () => ({
  extractManagedRuntimeWorkersFromMessages: mock(() => []),
  summarizeManagedRuntimeDirectToolUseFromMessages: mock(() => ({
    observed: false,
    count: 0,
    toolTypes: [],
    toolLabels: [],
    warning: null,
  })),
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: mock(async () => []),
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: mock(async () => []),
}));

// ---------------------------------------------------------------------------
// Goal-ledger mocks (mutable per test)
// ---------------------------------------------------------------------------

const listGoalsMock = mock(async (): Promise<WorkflowGoal[]> => []);
const listGoalEventsMock = mock(async (): Promise<WorkflowGoalEvent[]> => []);

mock.module("@/lib/db/goal-ledger", () => ({
  listGoals: listGoalsMock,
  listGoalEvents: listGoalEventsMock,
}));

// ---------------------------------------------------------------------------
// Route under test
// ---------------------------------------------------------------------------

const routeModulePromise = import("./route");

function makeRequest(chatId?: string): Request {
  const url = chatId
    ? `http://localhost/api/sessions/session-1/observability?chatId=${chatId}`
    : "http://localhost/api/sessions/session-1/observability";
  return new Request(url);
}

function routeContext(sessionId = "session-1") {
  return { params: Promise.resolve({ sessionId }) };
}

async function getBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("/api/sessions/[sessionId]/observability route — workflowGoals extension", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionMock.mockClear();
    listGoalsMock.mockClear();
    listGoalEventsMock.mockClear();
    // Reset to empty by default
    listGoalsMock.mockResolvedValue([]);
    listGoalEventsMock.mockResolvedValue([]);
  });

  test("BT-001: response includes workflowGoals array when goals exist for the session+chat", async () => {
    const goal: WorkflowGoal = {
      id: "goal-1",
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: null,
      objective: "Implement feature X",
      status: "running",
      blockedReason: null,
      evidenceRefs: ["ref-abc"],
      plan: null,
      createdAt: new Date("2026-05-01T10:00:00.000Z"),
      updatedAt: new Date("2026-05-01T11:00:00.000Z"),
    };
    const event: WorkflowGoalEvent = {
      id: "event-1",
      goalId: "goal-1",
      userId: "user-1",
      sequence: 1,
      eventType: "goal_started",
      summary: "Goal execution started.",
      payload: { note: "initial" },
      createdAt: new Date("2026-05-01T10:01:00.000Z"),
    };

    listGoalsMock.mockResolvedValue([goal]);
    listGoalEventsMock.mockResolvedValue([event]);

    const { GET } = await routeModulePromise;
    const response = await GET(makeRequest("chat-1"), routeContext());
    const body = await getBody(response);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.workflowGoals)).toBe(true);

    const goals = body.workflowGoals as Array<Record<string, unknown>>;
    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe("goal-1");
    expect(goals[0].objective).toBe("Implement feature X");
    expect(goals[0].status).toBe("running");
    expect(goals[0].blockedReason).toBeNull();
    expect(Array.isArray(goals[0].evidenceRefs)).toBe(true);
    expect((goals[0].evidenceRefs as string[])[0]).toBe("ref-abc");
    // Dates must be ISO strings, not Date objects
    expect(typeof goals[0].createdAt).toBe("string");
    expect(typeof goals[0].updatedAt).toBe("string");
    expect(goals[0].createdAt).toBe("2026-05-01T10:00:00.000Z");

    // Events must be embedded
    const events = goals[0].events as Array<Record<string, unknown>>;
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("event-1");
    expect(events[0].eventType).toBe("goal_started");
    expect(events[0].summary).toBe("Goal execution started.");
    expect(events[0].sequence).toBe(1);
    expect(typeof events[0].createdAt).toBe("string");
    expect(events[0].createdAt).toBe("2026-05-01T10:01:00.000Z");
  });

  test("BT-002: response includes workflowGoals: [] when no goals exist", async () => {
    listGoalsMock.mockResolvedValue([]);

    const { GET } = await routeModulePromise;
    const response = await GET(makeRequest("chat-2"), routeContext());
    const body = await getBody(response);

    expect(response.status).toBe(200);
    expect(Array.isArray(body.workflowGoals)).toBe(true);
    expect((body.workflowGoals as unknown[]).length).toBe(0);
  });

  test("BT-003: existing observability fields are preserved alongside workflowGoals", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(makeRequest("chat-1"), routeContext());
    const body = await getBody(response);

    expect(response.status).toBe(200);
    // All pre-existing fields must still be present
    expect("runtimeMode" in body).toBe(true);
    expect("events" in body).toBe(true);
    expect("profileRuns" in body).toBe(true);
    expect("workflowRuns" in body).toBe(true);
    expect("workers" in body).toBe(true);
    expect("directToolUse" in body).toBe(true);
    expect("services" in body).toBe(true);
    expect("browserRuns" in body).toBe(true);
    // New field also present
    expect("workflowGoals" in body).toBe(true);
  });

  test("BT-004: a goal-ledger query failure yields workflowGoals: [] without breaking the response", async () => {
    listGoalsMock.mockRejectedValue(new Error("DB connection refused"));

    const { GET } = await routeModulePromise;
    const response = await GET(makeRequest("chat-1"), routeContext());
    const body = await getBody(response);

    // Response must still succeed — defensive fallback
    expect(response.status).toBe(200);
    expect(Array.isArray(body.workflowGoals)).toBe(true);
    expect((body.workflowGoals as unknown[]).length).toBe(0);
    // Other fields must still be present
    expect("events" in body).toBe(true);
    expect("runtimeMode" in body).toBe(true);
  });

  test("BT-005: multiple goals each carry their own embedded events", async () => {
    const goalA: WorkflowGoal = {
      id: "goal-a",
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: null,
      objective: "Goal A",
      status: "complete",
      blockedReason: null,
      evidenceRefs: [],
      plan: null,
      createdAt: new Date("2026-05-01T10:00:00.000Z"),
      updatedAt: new Date("2026-05-01T11:00:00.000Z"),
    };
    const goalB: WorkflowGoal = {
      id: "goal-b",
      userId: "user-1",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: null,
      objective: "Goal B",
      status: "blocked",
      blockedReason: "waiting on external API",
      evidenceRefs: [],
      plan: null,
      createdAt: new Date("2026-05-01T12:00:00.000Z"),
      updatedAt: new Date("2026-05-01T13:00:00.000Z"),
    };
    const eventA: WorkflowGoalEvent = {
      id: "ev-a1",
      goalId: "goal-a",
      userId: "user-1",
      sequence: 1,
      eventType: "completed",
      summary: "A done",
      payload: {},
      createdAt: new Date("2026-05-01T11:00:00.000Z"),
    };

    listGoalsMock.mockResolvedValue([goalA, goalB]);
    // listGoalEvents called once per goal; alternate based on call order
    listGoalEventsMock
      .mockResolvedValueOnce([eventA])
      .mockResolvedValueOnce([]);

    const { GET } = await routeModulePromise;
    const response = await GET(makeRequest("chat-1"), routeContext());
    const body = await getBody(response);

    const goals = body.workflowGoals as Array<Record<string, unknown>>;
    expect(goals).toHaveLength(2);

    const a = goals.find((g) => g.id === "goal-a");
    const b = goals.find((g) => g.id === "goal-b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Non-optional access after .toBeDefined() assertion above
    expect((a as Record<string, unknown>).events).toHaveLength(1);
    expect((b as Record<string, unknown>).events).toHaveLength(0);
    expect((b as Record<string, unknown>).blockedReason).toBe(
      "waiting on external API",
    );
  });
});
