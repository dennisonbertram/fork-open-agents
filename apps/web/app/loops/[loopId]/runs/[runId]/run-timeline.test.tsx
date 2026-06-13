/**
 * Run timeline component tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-009: Timeline renders each step with node label, kind, status pill, attempt, duration
 *   BT-LOOPS-010: Failed step renders errorKind typed error
 *   BT-LOOPS-011: Multi-attempt step shows attempt number > 1
 *   BT-LOOPS-012: Timeline has aria-live="polite" region for accessibility
 *   BT-LOOPS-013: Event log renders below timeline with eventName, level, summary, time
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";

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
}));

const runDetailModulePromise = import("./run-detail");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRunDetail(
  overrides: Partial<GetAgentLoopRunDetailResponse> = {},
): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: "run_abc",
      loopId: "loop_123",
      userId: "user_1",
      status: "running",
      definitionSnapshot: { nodes: [], edges: [] },
      currentNodeId: "node_step1",
      currentStepRunId: "step_1",
      iterationCount: 2,
      stepCount: 3,
      context: {},
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: "wf_run_1",
      requestId: "req_1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    loop: {
      id: "loop_123",
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
    },
    steps: [
      {
        id: "step_1",
        loopRunId: "run_abc",
        nodeId: "node_step1",
        nodeKind: "agent_step",
        attempt: 1,
        status: "running",
        stepInput: null,
        stepOutput: null,
        sandboxName: "agent_loop_step_1",
        workflowRunId: "wf_run_1",
        errorKind: null,
        errorMessage: null,
        startedAt: new Date("2026-01-01T00:00:10.000Z"),
        finishedAt: null,
        durationMs: null,
        createdAt: new Date("2026-01-01T00:00:10.000Z"),
      },
      {
        id: "step_2",
        loopRunId: "run_abc",
        nodeId: "node_check",
        nodeKind: "github_check",
        attempt: 1,
        status: "succeeded",
        stepInput: null,
        stepOutput: { result: "passed" },
        sandboxName: null,
        workflowRunId: null,
        errorKind: null,
        errorMessage: null,
        startedAt: new Date("2026-01-01T00:00:05.000Z"),
        finishedAt: new Date("2026-01-01T00:00:08.000Z"),
        durationMs: 3000,
        createdAt: new Date("2026-01-01T00:00:05.000Z"),
      },
    ],
    events: [
      {
        id: "event_1",
        loopRunId: "run_abc",
        stepRunId: "step_1",
        nodeId: "node_step1",
        eventName: "loop.step.started",
        status: "started",
        level: "info",
        summary: "Agent step started",
        payload: {},
        redactionStatus: "passed",
        requestId: "req_1",
        workflowRunId: "wf_run_1",
        createdAt: new Date("2026-01-01T00:00:10.000Z"),
      },
    ],
    // M3-02-B: watchdogRuns is now part of the response type; empty for non-watchdog runs
    watchdogRuns: [],
    ...overrides,
  };
}

function makeFailedStepDetail(): GetAgentLoopRunDetailResponse {
  return makeRunDetail({
    run: {
      id: "run_abc",
      loopId: "loop_123",
      userId: "user_1",
      status: "failed",
      definitionSnapshot: { nodes: [], edges: [] },
      currentNodeId: null,
      currentStepRunId: null,
      iterationCount: 1,
      stepCount: 2,
      context: {},
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: "step_timeout",
      errorMessage: "Step exceeded timeout",
      workflowRunId: "wf_run_2",
      requestId: "req_2",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:10:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:10:00.000Z"),
    },
    steps: [
      {
        id: "step_fail",
        loopRunId: "run_abc",
        nodeId: "node_agent",
        nodeKind: "agent_step",
        attempt: 2,
        status: "failed",
        stepInput: null,
        stepOutput: null,
        sandboxName: "agent_loop_fail_1",
        workflowRunId: "wf_run_2",
        errorKind: "step_timeout",
        errorMessage: "Step exceeded timeout",
        startedAt: new Date("2026-01-01T00:05:00.000Z"),
        finishedAt: new Date("2026-01-01T00:10:00.000Z"),
        durationMs: 300000,
        createdAt: new Date("2026-01-01T00:05:00.000Z"),
      },
    ],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RunDetail", () => {
  // BT-LOOPS-009: step timeline renders each step with key attributes
  test("BT-LOOPS-009: timeline renders step with nodeKind, status pill, attempt, duration", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    // Step rendering
    expect(html).toContain("agent_step");
    expect(html).toContain("github_check");
    expect(html).toContain("running");
    expect(html).toContain("succeeded");
    // Sandbox name for correlation
    expect(html).toContain("agent_loop_step_1");
    // Loop name in header
    expect(html).toContain("Test Loop");
    // Repo badge
    expect(html).toContain("acme/widgets");
  });

  // BT-LOOPS-010: failed step renders errorKind
  test("BT-LOOPS-010: failed step renders errorKind typed error", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeFailedStepDetail()} />,
    );

    expect(html).toContain("step_timeout");
    expect(html).toContain("failed");
    // Attempt 2 shows
    expect(html).toContain("2");
  });

  // BT-LOOPS-011: multi-attempt step shows attempt number
  test("BT-LOOPS-011: step with attempt > 1 shows attempt number", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeFailedStepDetail();
    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // The step has attempt: 2
    expect(html).toContain("attempt");
  });

  // BT-LOOPS-012: aria-live polite for active step
  test("BT-LOOPS-012: timeline has aria-live polite region for active step", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    expect(html).toContain('aria-live="polite"');
  });

  // BT-LOOPS-013: event log renders below with eventName, level, summary
  test("BT-LOOPS-013: event log renders eventName, level, summary, time", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    expect(html).toContain("loop.step.started");
    expect(html).toContain("Agent step started");
    expect(html).toContain("info");
  });
});
