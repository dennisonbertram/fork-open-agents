import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import type { AgentLoopWatchdogRun } from "@/lib/db/schema";
import { VALID_FIXTURES } from "@/lib/agent-loops/fixtures";

mock.module("./run-graph", () => ({
  RunGraph: () => <div>Native graph canvas</div>,
}));

mock.module("swr", () => ({
  default: <TData,>(
    _key: string,
    _fetcher: unknown,
    options?: { fallbackData?: TData },
  ) => ({ data: options?.fallbackData, error: null }),
  mutate: async () => undefined,
}));

mock.module("./use-loop-run-polling", () => ({
  useLoopRunPolling: (
    _runId: string,
    initialData: GetAgentLoopRunDetailResponse,
  ) => ({
    data: initialData,
    error: null,
    liveness: { kind: "live" as const, secondsSinceUpdate: 1 },
  }),
  loopRunsListSwrKey: (loopId: string) => `/api/agent-loops/${loopId}/runs`,
}));

const detailModule = import("./run-detail");

function watchdog(): AgentLoopWatchdogRun {
  return {
    id: "watchdog-1",
    loopRunId: "loop-run-1",
    stepRunId: "step-1",
    nodeId: "start",
    status: "decided",
    decision: "pause",
    diagnosis: "Manual review required.",
    decisionPayload: null,
    attempt: 1,
    budgetRemaining: 2,
    startedAt: new Date("2026-07-11T10:01:30.000Z"),
    finishedAt: new Date("2026-07-11T10:01:31.000Z"),
    createdAt: new Date("2026-07-11T10:01:30.000Z"),
  };
}

function makeDetail(
  status: GetAgentLoopRunDetailResponse["run"]["status"],
): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: "loop-run-1",
      loopId: "loop-1",
      userId: "user-1",
      status,
      definitionSnapshot: VALID_FIXTURES[0]?.definition ?? {
        nodes: [],
        edges: [],
      },
      definitionVersion: null,
      definitionHash: null,
      snapshotSource: "legacy_live_fallback",
      currentNodeId: "start",
      currentStepRunId: "step-1",
      iterationCount: 1,
      stepCount: 1,
      source: "manual",
      triggerId: null,
      idempotencyKey: "key-1",
      errorKind: status === "failed" ? "step_failed" : null,
      errorMessage:
        status === "failed"
          ? "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 internal-host:9999"
          : null,
      workflowRunId: "workflow-1",
      requestId: "request-1",
      startedAt: new Date("2026-07-11T10:01:00.000Z"),
      finishedAt:
        status === "failed" ? new Date("2026-07-11T10:02:00.000Z") : null,
      createdAt: new Date("2026-07-11T10:00:00.000Z"),
      updatedAt: new Date("2026-07-11T10:01:30.000Z"),
    },
    loop: {
      id: "loop-1",
      name: "Release safely",
      repoOwner: "acme",
      repoName: "shop",
      guardrails: { maxStepsPerRun: 10, maxIterations: 3 },
      sourceDeleted: false,
      sourceActive: true,
    },
    steps: [
      {
        id: "step-1",
        loopRunId: "loop-run-1",
        nodeId: "start",
        nodeKind: "start",
        attempt: 1,
        status: status === "failed" ? "failed" : "running",
        stepInput: null,
        stepOutput: null,
        sandboxName: "sandbox-1",
        workflowRunId: "workflow-1",
        errorKind: status === "failed" ? "step_failed" : null,
        errorMessage: null,
        startedAt: new Date("2026-07-11T10:01:00.000Z"),
        finishedAt: null,
        durationMs: null,
        createdAt: new Date("2026-07-11T10:01:00.000Z"),
      },
    ],
    events: [
      {
        id: "event-1",
        loopRunId: "loop-run-1",
        stepRunId: "step-1",
        nodeId: "start",
        eventName: "agent-loop.step.composio.not_connected",
        status: "failed",
        level: "warn",
        summary: "Tool unavailable",
        payload: { disconnectedToolkits: ["slack"] },
        redactionStatus: "failed",
        requestId: "request-1",
        workflowRunId: "workflow-1",
        createdAt: new Date("2026-07-11T10:01:10.000Z"),
      },
    ],
    watchdogRuns: status === "paused" ? [watchdog()] : [],
  };
}

describe("canonical loop Run detail parity", () => {
  test("keeps graph, steps, events, warnings, watchdog, and correlation evidence", async () => {
    const { RunDetail } = await detailModule;
    const html = renderToStaticMarkup(
      <RunDetail initialData={makeDetail("paused")} variant="canonical" />,
    );

    expect(html).toContain("Multi-step Automation run");
    expect(html).toContain("Run graph");
    expect(html).toContain("Native graph canvas");
    expect(html).toContain("Step timeline");
    expect(html).toContain("Watchdog paused this run");
    expect(html).toContain("Event log");
    expect(html).toContain("slack");
    expect(html).toContain("Correlation IDs");
    expect(html).toContain("redaction failed");
  });

  test("preserves the native action predicate matrix", async () => {
    const { RunDetail } = await detailModule;
    const running = renderToStaticMarkup(
      <RunDetail initialData={makeDetail("running")} variant="canonical" />,
    );
    const paused = renderToStaticMarkup(
      <RunDetail initialData={makeDetail("paused")} variant="canonical" />,
    );
    const failed = renderToStaticMarkup(
      <RunDetail initialData={makeDetail("failed")} variant="canonical" />,
    );
    const completed = renderToStaticMarkup(
      <RunDetail initialData={makeDetail("completed")} variant="canonical" />,
    );

    expect(running).toContain(">Pause</button>");
    expect(running).toContain("Cancel run");
    expect(running).not.toContain(">Resume</button>");
    expect(running).not.toContain(">Retry</button>");
    expect(paused).toContain(">Resume</button>");
    expect(paused).toContain("Cancel run");
    expect(paused).not.toContain(">Pause</button>");
    expect(paused).not.toContain(">Retry</button>");
    expect(failed).toContain(">Retry</button>");
    expect(failed).not.toContain(">Pause</button>");
    expect(failed).not.toContain(">Resume</button>");
    expect(failed).not.toContain("Cancel run");
    expect(completed).not.toContain(">Pause</button>");
    expect(completed).not.toContain(">Resume</button>");
    expect(completed).not.toContain(">Retry</button>");
    expect(completed).not.toContain("Cancel run");
    expect(failed).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  test("renders retained snapshot evidence but no source links or controls after deletion", async () => {
    const { RunDetail } = await detailModule;
    const retained = makeDetail("cancelled");
    retained.run.loopId = null;
    retained.run.errorKind = "source_deleted";
    retained.run.errorMessage = "Source Automation deleted";
    retained.loop = null;

    const html = renderToStaticMarkup(
      <RunDetail initialData={retained} variant="canonical" />,
    );

    expect(html).toContain("Deleted automation");
    expect(html).toContain("Source deleted; execution history retained.");
    expect(html).toContain("Run graph");
    expect(html).toContain("Step timeline");
    expect(html).toContain("Event log");
    expect(html).not.toContain(">Resume</button>");
    expect(html).not.toContain(">Retry</button>");
    expect(html).not.toContain("/automations/agent-loop/");
  });
});
