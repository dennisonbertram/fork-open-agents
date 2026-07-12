/**
 * Regression tests for Agent Loops UI (M1-09, TASK-328)
 *
 * These tests catch specific breakage scenarios if the implementation is
 * reverted or key behaviors are accidentally changed.
 *
 * REG-LOOPS-001: LoopsList does NOT render loop cards when feature is disabled
 * REG-LOOPS-002: computeLoopRunRefreshInterval returns 0 for ALL terminal statuses
 * REG-LOOPS-003: RunDetail proof strip shows correlation IDs (workflowRunId, requestId)
 * REG-LOOPS-004: RunActions does NOT render pause for terminal run (regression: wrong state)
 * REG-LOOPS-005: LoopCreateForm validation errors are per-rule, not generic
 */

import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";

// Mock run-graph to avoid React Flow native bindings in SSR test environment
mock.module("./[loopId]/runs/[runId]/run-graph", () => ({
  RunGraph: () => null,
}));

// ── SWR mock ──────────────────────────────────────────────────────────────────

type SWRState<T> = { data?: T; error?: Error; isLoading: boolean };
let _swrOverride: SWRState<unknown> = { isLoading: false };

mock.module("swr", () => ({
  default: <T,>(
    _key: string,
    _fetcher?: unknown,
    opts?: { fallbackData?: T },
  ) =>
    opts?.fallbackData
      ? { data: opts.fallbackData, error: null }
      : (_swrOverride as SWRState<T>),
  mutate: async () => undefined,
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));
mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const loopsListModule = import("./loops-list");
const createFormModule = import("./loop-create-form");
const runDetailModule = import("./[loopId]/runs/[runId]/run-detail");
const runActionsModule = import("./[loopId]/runs/[runId]/run-actions");
const pollingModule = import("./[loopId]/runs/[runId]/use-loop-run-polling");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRunDetail(): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: "run_regression",
      loopId: "loop_123",
      userId: "user_1",
      status: "running",
      definitionSnapshot: { nodes: [], edges: [] },
      definitionVersion: null,
      definitionHash: null,
      snapshotSource: "legacy_live_fallback",
      currentNodeId: "node_agent",
      currentStepRunId: "step_1",
      iterationCount: 1,
      stepCount: 2,
      source: "manual",
      triggerId: null,
      idempotencyKey: "key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: "wf_reg_001",
      requestId: "req_reg_001",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    loop: {
      id: "loop_123",
      name: "Regression Loop",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
      sourceDeleted: false,
      sourceActive: true,
    },
    steps: [],
    events: [],
    // M3-02-B: watchdogRuns is now required in GetAgentLoopRunDetailResponse
    watchdogRuns: [],
  };
}

// ── Regression tests ──────────────────────────────────────────────────────────

describe("Regression: Loops UI", () => {
  // REG-LOOPS-001: LoopsList does NOT render loop name when feature is disabled
  test("REG-LOOPS-001: disabled feature shows disabled message, NOT loop cards", async () => {
    _swrOverride = {
      data: undefined,
      error: Object.assign(new Error("Feature disabled"), {
        errorKind: "feature_disabled",
        status: 403,
      }),
      isLoading: false,
    };
    const { LoopsList } = await loopsListModule;
    const html = renderToStaticMarkup(<LoopsList />);

    // Must show disabled state
    expect(html).toContain("disabled");
    // Must NOT show any loop card content (regression: was showing stale card data)
    expect(html).not.toContain("My Test Loop");
    expect(html).not.toContain("acme/widgets");
  });

  // REG-LOOPS-002: All terminal statuses stop polling
  test("REG-LOOPS-002: computeLoopRunRefreshInterval returns 0 for all terminal statuses", async () => {
    const { computeLoopRunRefreshInterval } = await pollingModule;
    const terminalStatuses = ["completed", "failed", "cancelled", "stalled"];

    for (const status of terminalStatuses) {
      expect(computeLoopRunRefreshInterval(status)).toBe(0);
    }
    // Active statuses must still poll
    expect(computeLoopRunRefreshInterval("running")).toBe(2000);
    expect(computeLoopRunRefreshInterval("queued")).toBe(2000);
  });

  // REG-LOOPS-003: RunDetail renders correlation IDs
  test("REG-LOOPS-003: run page shows workflowRunId and requestId for observability", async () => {
    const { RunDetail } = await runDetailModule;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeRunDetail()} />,
    );

    // These correlation IDs must be visible for debugging
    expect(html).toContain("wf_reg_001");
    expect(html).toContain("req_reg_001");
    // Correlation IDs section present
    expect(html).toContain("Correlation");
  });

  // REG-LOOPS-004: RunActions does NOT show pause for terminal run
  //
  // #767 update: the store rejects retry for completed/cancelled runs
  // (store.ts retryCurrentStep), so Retry must NOT render for a completed
  // run either — only failed/stalled are retry-eligible. See
  // run-actions.retry-gating.test.tsx for the full gating matrix.
  test("REG-LOOPS-004: RunActions does not render pause or retry for a completed run", async () => {
    const { RunActions } = await runActionsModule;
    const html = renderToStaticMarkup(
      <RunActions runId="run_1" status="completed" loopId="loop_1" />,
    );

    // Pause must not appear for terminal runs
    expect(html.toLowerCase()).not.toContain("pause");
    // Retry must not appear either — the store rejects retry for completed runs
    expect(html.toLowerCase()).not.toContain("retry");
  });

  // REG-LOOPS-005: Create form renders per-rule validation errors, not generic
  test("REG-LOOPS-005: create form renders per-rule structured errors with rule code", async () => {
    const { LoopCreateForm } = await createFormModule;
    const errors = [
      {
        kind: "loop_invalid" as const,
        rule: "no_start" as const,
        message: "Definition must have exactly one start node.",
      },
    ];
    const html = renderToStaticMarkup(
      <LoopCreateForm initialValidationErrors={errors} />,
    );

    // Rule code must be visible for actionable feedback
    expect(html).toContain("no_start");
    // Full message must be visible
    expect(html).toContain("Definition must have exactly one start node.");
    // Must NOT show generic "unknown error" text
    expect(html).not.toContain("unknown error");
  });
});
