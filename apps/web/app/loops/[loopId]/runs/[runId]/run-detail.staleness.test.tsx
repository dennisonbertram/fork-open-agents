/**
 * RunDetail — liveness-driven refresh indicator (#880).
 *
 * The hardcoded "Refreshing every 2s" footer claimed liveness it was not
 * delivering. It must be replaced by a liveness-driven render:
 *   - live:     "Updated {n}s ago" (still communicates live polling)
 *   - stalled:  visible amber "Live updates stalled" warning
 *   - terminal: neither string renders
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";

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

type Liveness =
  | { kind: "terminal" }
  | { kind: "live"; secondsSinceUpdate: number }
  | { kind: "stalled"; secondsSinceUpdate: number };

let mockLiveness: Liveness = { kind: "terminal" };

mock.module("./use-loop-run-polling", () => ({
  useLoopRunPolling: () => ({
    data: undefined,
    error: null,
    liveness: mockLiveness,
  }),
  loopRunsListSwrKey: (id: string) => `/api/agent-loops/${id}/runs`,
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
      status: "running",
      definitionSnapshot: { nodes: [], edges: [] },
      currentNodeId: "node_step1",
      currentStepRunId: "step_1",
      iterationCount: 0,
      stepCount: 1,
      context: {},
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: null,
      requestId: "req_1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: null,
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

describe("RunDetail liveness indicator (#880)", () => {
  test("stalled liveness renders the stall warning and never claims 'Refreshing every 2s'", async () => {
    mockLiveness = { kind: "stalled", secondsSinceUpdate: 34 };
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail();

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).toContain("Live updates stalled");
    expect(html).toContain("34s ago");
    expect(html).not.toContain("Refreshing every 2s");
  });

  test("live liveness renders 'Updated Ns ago'", async () => {
    mockLiveness = { kind: "live", secondsSinceUpdate: 2 };
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail();

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).toContain("Updated 2s ago");
  });

  test("terminal liveness renders neither the live nor stalled copy", async () => {
    mockLiveness = { kind: "terminal" };
    const { RunDetail } = await runDetailModulePromise;
    const data = makeRunDetail({
      run: { ...makeRunDetail().run, status: "failed" },
    });

    const html = renderToStaticMarkup(<RunDetail initialData={data} />);

    expect(html).not.toContain("Updated");
    expect(html).not.toContain("Live updates stalled");
  });
});
