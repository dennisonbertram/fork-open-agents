import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let runRow: Record<string, unknown> | undefined = {
  run: {
    id: "run-1",
    userId: "user-1",
    status: "running",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-123",
    idempotencyKey: "agent-1:trigger-1:delivery-123",
    repoOwner: "acme",
    repoName: "widgets",
    requestId: "req-123",
    workflowRunId: "workflow-1",
    createdAt: new Date("2026-05-27T12:00:00.000Z"),
  },
  agent: {
    id: "agent-1",
    name: "PR reviewer",
    permissions: { github: { contents: "write" } },
    checkCommand: "bun --bun run ci",
  },
};
let events: Record<string, unknown>[] = [
  {
    id: "event-1",
    runId: "run-1",
    eventName: "background-agent.trigger.received",
    status: "started",
    requestId: "req-123",
    workflowRunId: "workflow-1",
    sandboxName: null,
    errorKind: null,
    redactionStatus: "passed",
    payload: { externalId: "delivery-123" },
    createdAt: new Date("2026-05-27T12:00:01.000Z"),
  },
];
let outputs: Record<string, unknown>[] = [
  {
    id: "output-1",
    runId: "run-1",
    kind: "ready_pr",
    status: "created",
    url: "https://github.com/acme/widgets/pull/42",
    prNumber: 42,
  },
];

const getOwnedBackgroundAgentRunWithAgent = mock(async () => runRow);
const listBackgroundAgentEvents = mock(async () => events);
const listBackgroundAgentOutputs = mock(async () => outputs);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
}));

const routeModulePromise = import("./route");

function context(runId = "run-1") {
  return {
    params: Promise.resolve({ runId }),
  };
}

describe("GET /api/background-agent-runs/[runId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    runRow = {
      run: {
        id: "run-1",
        userId: "user-1",
        status: "running",
        source: "github",
        triggerKind: "github.pull_request",
        externalId: "delivery-123",
        idempotencyKey: "agent-1:trigger-1:delivery-123",
        repoOwner: "acme",
        repoName: "widgets",
        requestId: "req-123",
        workflowRunId: "workflow-1",
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
      },
      agent: {
        id: "agent-1",
        name: "PR reviewer",
        permissions: { github: { contents: "write" } },
        checkCommand: "bun --bun run ci",
      },
    };
    events = [
      {
        id: "event-1",
        runId: "run-1",
        eventName: "background-agent.trigger.received",
        status: "started",
        requestId: "req-123",
        workflowRunId: "workflow-1",
        sandboxName: null,
        errorKind: null,
        redactionStatus: "passed",
        payload: { externalId: "delivery-123" },
        createdAt: new Date("2026-05-27T12:00:01.000Z"),
      },
    ];
    outputs = [
      {
        id: "output-1",
        runId: "run-1",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
        prNumber: 42,
      },
    ];
    getOwnedBackgroundAgentRunWithAgent.mockClear();
    listBackgroundAgentEvents.mockClear();
    listBackgroundAgentOutputs.mockClear();
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs/run-1"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(getOwnedBackgroundAgentRunWithAgent).not.toHaveBeenCalled();
  });

  test("returns not found outside the user scope", async () => {
    runRow = undefined;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs/run-1"),
      context(),
    );

    expect(response.status).toBe(404);
    expect(listBackgroundAgentEvents).not.toHaveBeenCalled();
    expect(listBackgroundAgentOutputs).not.toHaveBeenCalled();
  });

  test("returns correlation, redaction, and output evidence for live debugging", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs/run-1"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getOwnedBackgroundAgentRunWithAgent).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
    });
    expect(body.run).toMatchObject({
      id: "run-1",
      externalId: "delivery-123",
      idempotencyKey: "agent-1:trigger-1:delivery-123",
      requestId: "req-123",
      workflowRunId: "workflow-1",
    });
    expect(body.agent).toEqual({
      id: "agent-1",
      name: "PR reviewer",
      permissions: { github: { contents: "write" } },
      checkCommand: "bun --bun run ci",
    });
    expect(body.events[0]).toMatchObject({
      requestId: "req-123",
      redactionStatus: "passed",
      payload: { externalId: "delivery-123" },
    });
    expect(body.outputs[0]).toMatchObject({
      kind: "ready_pr",
      status: "created",
      prNumber: 42,
    });
  });

  // BT-API-001: run response includes resultSummary (#163)
  test("BT-API-001: response includes resultSummary when run has one", async () => {
    const resultSummary = {
      headline: "Run succeeded — created ready_pr #42",
      checked: ["bun --bun run ci passed"],
      changed: [],
      blocked: [],
      artifacts: [
        {
          kind: "ready_pr",
          label: "PR #42",
          url: "https://github.com/acme/widgets/pull/42",
          prNumber: 42,
        },
      ],
      next: [],
    };
    runRow = {
      run: {
        ...(runRow as Record<string, unknown>)!.run,
        resultSummary,
      },
      agent: (runRow as Record<string, unknown>)!.agent,
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs/run-1"),
      context(),
    );
    const body = (await response.json()) as { run: Record<string, unknown> };

    expect(response.status).toBe(200);
    // The run response must pass through resultSummary
    expect(body.run.resultSummary).toBeDefined();
    expect((body.run.resultSummary as Record<string, unknown>).headline).toBe(
      "Run succeeded — created ready_pr #42",
    );
  });

  // BT-API-002: resultSummary is null when not yet generated (#163)
  test("BT-API-002: resultSummary is null when run has no summary", async () => {
    // runRow already uses run without resultSummary field — beforeEach sets it
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/background-agent-runs/run-1"),
      context(),
    );
    const body = (await response.json()) as { run: Record<string, unknown> };

    expect(response.status).toBe(200);
    // resultSummary should be null or undefined (not a non-null wrong value)
    expect(body.run.resultSummary ?? null).toBeNull();
  });
});
