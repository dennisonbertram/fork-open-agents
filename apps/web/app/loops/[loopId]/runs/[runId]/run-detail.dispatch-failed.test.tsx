/**
 * RunDetail — dispatch_failed error banner (issue #763 — "no false success")
 *
 * BT-DF-04: a run with status="failed" and errorKind="dispatch_failed" renders
 *           the existing generic red errorKind banner (run-detail.tsx ~377-389).
 *           The banner is intentionally generic — it renders any run.errorKind
 *           verbatim plus run.errorMessage; the full copy-map overhaul is #767
 *           (out of scope here). This test pins that dispatch_failed is not
 *           silently swallowed by the banner condition.
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

function makeRunDetail(
  overrides: Partial<GetAgentLoopRunDetailResponse> = {},
): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: "run_abc",
      loopId: "loop_123",
      userId: "user_1",
      status: "failed",
      definitionSnapshot: { nodes: [], edges: [] },
      currentNodeId: "node_step1",
      currentStepRunId: "step_1",
      iterationCount: 0,
      stepCount: 1,
      context: {},
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: "dispatch_failed",
      errorMessage:
        "Couldn't start the run — the execution backend rejected the dispatch: boom",
      workflowRunId: null,
      requestId: "req_1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:01.000Z"),
    },
    loop: {
      id: "loop_123",
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
    },
    steps: [],
    events: [],
    watchdogRuns: [],
    ...overrides,
  };
}

describe("BT-DF-04: RunDetail renders the errorKind banner for dispatch_failed", () => {
  test("BT-DF-04: run.errorKind=dispatch_failed renders the red banner with errorKind and errorMessage", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail();

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).toContain("dispatch_failed");
    expect(html).toContain(
      "Couldn&#x27;t start the run — the execution backend rejected the dispatch: boom",
    );
  });
});
