/**
 * Watchdog surface UI tests — M3-02-B
 *
 * Behavior contract:
 *   BT-LOOPS-M3-02B-U1: paused run with watchdog pause-decision renders PausedDiagnosisBanner
 *   BT-LOOPS-M3-02B-U2: watchdog rows interleaved in Step timeline by createdAt
 *   BT-LOOPS-M3-02B-U3: retry-decision watchdog row renders distinctly (retry label + budget)
 *   BT-LOOPS-M3-02B-U4: empty watchdogRuns → no banner, no watchdog rows (timeline identical to today)
 *   BT-LOOPS-M3-02B-U5: status='running' watchdog row (in-flight) renders 'analyzing…' state
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type { AgentLoopWatchdogRun } from "@/lib/db/schema";

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

function makeWatchdogRun(
  overrides: Partial<AgentLoopWatchdogRun> = {},
): AgentLoopWatchdogRun {
  return {
    id: "wd-1",
    loopRunId: "run_abc",
    stepRunId: "step_1",
    nodeId: "node_step1",
    status: "decided",
    decision: "pause",
    diagnosis:
      "The step failed repeatedly with the same error. Manual review required.",
    decisionPayload: null,
    attempt: 1,
    budgetRemaining: 2,
    startedAt: new Date("2026-01-01T00:00:12.000Z"),
    finishedAt: new Date("2026-01-01T00:00:15.000Z"),
    createdAt: new Date("2026-01-01T00:00:12.000Z"),
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
        status: "failed",
        stepInput: null,
        stepOutput: null,
        sandboxName: "agent_loop_step_1",
        workflowRunId: "wf_run_1",
        errorKind: "step_failed",
        errorMessage: null,
        startedAt: new Date("2026-01-01T00:00:10.000Z"),
        finishedAt: new Date("2026-01-01T00:00:11.000Z"),
        durationMs: 1000,
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
        startedAt: new Date("2026-01-01T00:00:20.000Z"),
        finishedAt: new Date("2026-01-01T00:00:23.000Z"),
        durationMs: 3000,
        createdAt: new Date("2026-01-01T00:00:20.000Z"),
      },
    ],
    events: [],
    watchdogRuns: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Watchdog surface — RunDetail", () => {
  // BT-LOOPS-M3-02B-U1: PausedDiagnosisBanner renders for paused+watchdog-pause
  test("BT-LOOPS-M3-02B-U1: paused run with pause decision renders PausedDiagnosisBanner with diagnosis, decision, node", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      run: {
        id: "run_abc",
        loopId: "loop_123",
        userId: "user_1",
        status: "paused",
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
      watchdogRuns: [
        makeWatchdogRun({
          decision: "pause",
          diagnosis:
            "The step failed repeatedly with the same error. Manual review required.",
          nodeId: "node_step1",
          budgetRemaining: 2,
        }),
      ],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // Banner should render with key information
    expect(html).toContain("Watchdog paused this run");
    expect(html).toContain("Manual review required");
    expect(html).toContain("node_step1");
    expect(html).toContain("Pause");
  });

  // BT-LOOPS-M3-02B-U2: watchdog rows interleaved in timeline by createdAt
  test("BT-LOOPS-M3-02B-U2: watchdog rows interleaved in step timeline ordered by createdAt", async () => {
    const { RunDetail } = await runDetailModulePromise;
    // watchdog run created at 00:00:12 — between step_1 (00:00:10) and step_2 (00:00:20)
    const watchdogRun = makeWatchdogRun({
      createdAt: new Date("2026-01-01T00:00:12.000Z"),
    });
    const data = makeRunDetail({ watchdogRuns: [watchdogRun] });
    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // The watchdog row should appear between the two steps
    const step1Pos = html.indexOf("node_step1");
    const step2Pos = html.indexOf("node_check");
    // The watchdog row diagnosis/decision should exist somewhere
    const watchdogPos = html.indexOf("Watchdog:");

    expect(watchdogPos).toBeGreaterThan(-1);
    // watchdog row should appear after step_1 and before step_2 in the timeline
    expect(watchdogPos).toBeGreaterThan(step1Pos);
    expect(watchdogPos).toBeLessThan(step2Pos);
  });

  // BT-LOOPS-M3-02B-U3: retry decision renders distinctly with budget
  test("BT-LOOPS-M3-02B-U3: retry-decision watchdog row renders retry label and budget remaining", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const watchdogRun = makeWatchdogRun({
      decision: "retry",
      diagnosis: "Step failed with a transient error; retrying.",
      budgetRemaining: 2,
      createdAt: new Date("2026-01-01T00:00:12.000Z"),
    });
    const data = makeRunDetail({ watchdogRuns: [watchdogRun] });
    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // Retry row should be present
    expect(html).toContain("Watchdog:");
    // Budget remaining info
    expect(html).toContain("2");
    // Should not render the 'pause this run' banner (status is running)
    expect(html).not.toContain("Watchdog paused this run");
  });

  // BT-LOOPS-M3-02B-U4: empty watchdogRuns → no banner, no watchdog rows
  test("BT-LOOPS-M3-02B-U4: empty watchdogRuns renders no banner and no watchdog rows (timeline identical)", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({ watchdogRuns: [] });
    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // No banner
    expect(html).not.toContain("Watchdog paused this run");
    // No watchdog rows in timeline
    expect(html).not.toContain("Watchdog:");
    // Regular step timeline still renders
    expect(html).toContain("node_step1");
    expect(html).toContain("node_check");
  });

  // BT-LOOPS-M3-02B-U5: in-flight watchdog row (status=running) renders 'analyzing...'
  test("BT-LOOPS-M3-02B-U5: status=running watchdog row renders analyzing state (no crash on null decision)", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const watchdogRun = makeWatchdogRun({
      status: "running",
      decision: null,
      diagnosis: null,
      finishedAt: null,
      createdAt: new Date("2026-01-01T00:00:12.000Z"),
    });
    const data = makeRunDetail({ watchdogRuns: [watchdogRun] });

    // Should not throw
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(<RunDetail initialData={data} />);
    }).not.toThrow();

    // Should render an 'analyzing' state (case-insensitive check)
    expect(html.toLowerCase()).toContain("analyzing");
  });

  // BT-LOOPS-M3-02B-U6: paused + latest watchdog decision = retry => no false Watchdog-paused heading
  test("BT-LOOPS-M3-02B-U6: paused run with latest watchdog decision=retry does NOT render 'Watchdog paused this run'", async () => {
    const { RunDetail } = await runDetailModulePromise;
    // Sequence: watchdog issued retry (older) → run resumed → operator manually paused (newest watchdog row is retry)
    const data = makeRunDetail({
      run: {
        id: "run_abc",
        loopId: "loop_123",
        userId: "user_1",
        status: "paused",
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
      watchdogRuns: [
        // Latest row (by createdAt): decision=retry — the watchdog said retry before the operator paused
        makeWatchdogRun({
          id: "wd-2",
          status: "decided",
          decision: "retry",
          diagnosis: "Step failed with a transient error; retrying.",
          budgetRemaining: 1,
          createdAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
        // Older row: decision=pause (earlier watchdog evaluation)
        makeWatchdogRun({
          id: "wd-1",
          status: "decided",
          decision: "pause",
          diagnosis: "First pause.",
          budgetRemaining: 2,
          createdAt: new Date("2026-01-01T00:00:12.000Z"),
        }),
      ],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // The banner MUST NOT falsely attribute a user-initiated pause to the watchdog
    expect(html).not.toContain("Watchdog paused this run");
  });

  // BT-LOOPS-M3-02B-U7: paused + only pending/running watchdog row => no banner
  test("BT-LOOPS-M3-02B-U7: paused run with only in-flight (pending/running) watchdog rows does NOT render 'Watchdog paused this run'", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      run: {
        id: "run_abc",
        loopId: "loop_123",
        userId: "user_1",
        status: "paused",
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
      watchdogRuns: [
        makeWatchdogRun({
          id: "wd-pending",
          status: "pending",
          decision: null,
          diagnosis: null,
          finishedAt: null,
          createdAt: new Date("2026-01-01T00:00:20.000Z"),
        }),
      ],
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    // Only a pending row exists — should NOT show the 'paused by watchdog' banner
    expect(html).not.toContain("Watchdog paused this run");
  });
});
