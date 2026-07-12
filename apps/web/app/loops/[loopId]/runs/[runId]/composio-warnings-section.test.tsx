/**
 * #798 — agent-loop run detail parity for Composio degradation visibility.
 *
 * Behavior contract:
 *   BT-UI-001: a succeeded run with a composio.off event still shows a
 *     distinct "Warnings" block (loop parity with the background-agent
 *     run-summary-section.tsx warnings block).
 *   BT-UI-002: a run with no composio events renders no Warnings block
 *     (no false positives for agents/steps with no Composio configured).
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type { AgentLoopEvent } from "@/lib/db/schema";

// Mock run-graph to avoid React Flow native bindings in SSR test environment
mock.module("./run-graph", () => ({
  RunGraph: () => null,
}));

mock.module("swr", () => ({
  default: <T,>(
    _key: string,
    _fetcher: unknown,
    options?: { fallbackData?: T },
  ) => ({
    data: options?.fallbackData,
    error: null,
  }),
  mutate: async () => undefined,
}));

const runDetailModulePromise = import("./run-detail");

function makeEvent(overrides: Partial<AgentLoopEvent> = {}): AgentLoopEvent {
  return {
    id: "evt-1",
    loopRunId: "run_abc",
    stepRunId: "step_1",
    nodeId: "node_step1",
    eventName: "agent-loop.step.agent.completed",
    status: "succeeded",
    level: "info",
    summary: null,
    payload: {},
    redactionStatus: "passed",
    requestId: "req_1",
    workflowRunId: "wf_run_1",
    createdAt: new Date("2026-01-01T00:00:10.000Z"),
    ...overrides,
  };
}

function makeRunDetail(
  overrides: Partial<GetAgentLoopRunDetailResponse> = {},
): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: "run_abc",
      loopId: "loop_123",
      userId: "user_1",
      status: "completed",
      definitionSnapshot: { nodes: [], edges: [] },
      definitionVersion: null,
      definitionHash: null,
      snapshotSource: "legacy_live_fallback",
      currentNodeId: null,
      currentStepRunId: null,
      iterationCount: 1,
      stepCount: 1,
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: "wf_run_1",
      requestId: "req_1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:01:00.000Z"),
    },
    loop: {
      id: "loop_123",
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
      sourceDeleted: false,
      sourceActive: true,
    },
    steps: [],
    events: [],
    watchdogRuns: [],
    ...overrides,
  };
}

describe("ComposioWarningsSection — RunDetail parity (#798)", () => {
  test("BT-UI-001: succeeded run with composio.off event shows a distinct Warnings block", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      events: [
        makeEvent({
          eventName: "agent-loop.step.composio.off",
          level: "warn",
          payload: { reason: "no_slugs_selected" },
        }),
      ],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).toContain("Warnings");
    expect(html.toLowerCase()).toContain("composio");
  });

  test("BT-UI-002: not_connected event names the disconnected toolkit in the warnings block", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      events: [
        makeEvent({
          eventName: "agent-loop.step.composio.not_connected",
          level: "warn",
          payload: { disconnectedToolkits: ["slack"] },
        }),
      ],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).toContain("Warnings");
    expect(html).toContain("slack");
  });

  test("BT-UI-003 (scope guard): no composio events -> no Warnings block rendered", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      events: [makeEvent()],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).not.toContain("Warnings");
  });
});
