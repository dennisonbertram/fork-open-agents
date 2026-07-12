/**
 * RunDetail — terminal-style metadata layout (#895).
 *
 * Naive-user finding: run metadata reflowed / "jumped" as strings got long.
 * Root cause: the Proof strip rendered `ProofItem` cards in a content-sized
 * responsive grid (`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6`).
 * A long `workflowRunId`, UUID `requestId`, or the idempotency key made cells
 * uneven, so the grid re-packed — and it shifted again on every poll.
 *
 * These tests pin RunDetail to the RunMetadataTable replacement: the old
 * reflow-prone grid class is gone, a long workflowRunId lives in a
 * non-reflowing `overflow-x-auto` cell (not the old `truncate` cell), and a
 * run without a workflowRunId/requestId/currentNodeId yet still renders
 * those rows with a "—" placeholder instead of omitting them (stable row
 * set, #895 behavior contract).
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

mock.module("./use-loop-run-polling", () => ({
  useLoopRunPolling: () => ({
    data: undefined,
    error: null,
    liveness: { kind: "terminal" as const },
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
      definitionVersion: null,
      definitionHash: null,
      snapshotSource: "legacy_live_fallback",
      currentNodeId: null,
      currentStepRunId: null,
      iterationCount: 0,
      stepCount: 1,
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: null,
      requestId: null,
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
      sourceDeleted: false,
      sourceActive: true,
    },
    steps: [],
    events: [],
    watchdogRuns: [],
    ...overrides,
  };
}

describe("RunDetail metadata layout (#895)", () => {
  test("the proof strip no longer uses the content-sized reflow grid", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    expect(html).not.toContain("sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6");
  });

  test("a long workflowRunId renders in a non-reflowing overflow-x-auto cell, not the old truncate cell", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const longId = "wrun_01KWNBP9FHXHQ4YE77GBX0C1VP4Z9Q2X7K3M5N6";
    const base = makeRunDetail();
    const html = renderToStaticMarkup(
      <RunDetail
        initialData={{ ...base, run: { ...base.run, workflowRunId: longId } }}
      />,
    );

    expect(html).toContain(longId);
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain('class="truncate font-mono text-xs"');
  });

  test("a run missing workflowRunId/requestId/currentNodeId still renders those rows with a placeholder", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    expect(html).toContain("Workflow Run");
    expect(html).toContain("Request ID");
    expect(html).toContain("Current Node");
    expect(html).toContain("—");
  });

  test("the Correlation IDs block renders the idempotency key in a non-reflowing cell", async () => {
    const { RunDetail } = await runDetailModulePromise;
    const longKey =
      "loop_9c3d5f6a7b8c-idempotency-2994ac80-9e66-4558-8c1c-81128e52c26d";
    const base = makeRunDetail();
    const html = renderToStaticMarkup(
      <RunDetail
        initialData={{
          ...base,
          run: { ...base.run, idempotencyKey: longKey },
        }}
      />,
    );

    expect(html).toContain("Correlation IDs");
    expect(html).toContain(longKey);
    // Regression guard: only one bordered container class present per
    // metadata block, not N per-card borders.
    expect(html).not.toContain("bg-muted/20 px-3 py-2");
  });
});
