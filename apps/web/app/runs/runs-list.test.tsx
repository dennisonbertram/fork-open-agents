import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let swrState: {
  data?: Record<string, unknown>;
  error?: Error;
  isLoading: boolean;
};

function populatedState() {
  return {
    data: {
      requestId: "request-1",
      generatedAt: "2026-07-11T12:00:00.000Z",
      items: [
        {
          id: "background_agent:bg-1",
          source: "background_agent",
          sourceId: "bg-1",
          nativeStatus: "running",
          nativeSource: "github",
          title: "Review PRs",
          state: "running",
          outcome: null,
          health: "needs_attention",
          attentionReasons: ["stale"],
          repository: { owner: "acme", name: "shop", branch: "main" },
          detailUrl: "/background-runs/bg-1",
          timestamps: {
            createdAt: "2026-07-11T10:00:00.000Z",
            updatedAt: "2026-07-11T11:00:00.000Z",
            startedAt: "2026-07-11T10:00:00.000Z",
            finishedAt: null,
          },
          metadata: {},
          automation: { source: "background_agent", sourceId: "agent-1" },
          automationName: "Review PRs",
          trigger: {
            id: "trigger-1",
            source: "github",
            kind: "github.pull_request",
          },
          progress: { currentStepId: null, completedSteps: 0, totalSteps: 1 },
          evidence: {
            requestId: "request-1",
            workflowRunId: "workflow-1",
            sandboxName: "sandbox-1",
            outputUrl: null,
          },
        },
      ],
      sourceStatus: [
        { source: "background_agent", status: "ok", itemCount: 1 },
        {
          source: "agent_loop",
          status: "failed",
          itemCount: 0,
          safeErrorKind: "source_unavailable",
        },
      ],
      allSourcesFailed: false,
    },
    error: undefined,
    isLoading: false,
  };
}

mock.module("swr", () => ({
  default: () => swrState,
}));

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=active"),
}));

const componentPromise = import("./runs-list");

describe("RunsList", () => {
  beforeEach(() => {
    swrState = populatedState();
  });

  test("shows truthful dimensions, partial gaps, URL filters, and native evidence links", async () => {
    const { RunsList } = await componentPromise;
    const html = renderToStaticMarkup(<RunsList searchParams="view=active" />);

    expect(html).toContain("Review PRs");
    expect(html).toContain("Running");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Single-step");
    expect(html).toContain("acme/shop");
    expect(html).toContain("github.pull_request");
    expect(html).toContain("Some run history is unavailable");
    expect(html).toContain('href="/background-runs/bg-1"');
    expect(html).toContain("automationSource=background_agent");
    expect(html).toContain("repoOwner=acme");
  });

  test.each([
    {
      name: "initial loading",
      state: { data: undefined, error: undefined, isLoading: true },
      expected: "Loading runs",
    },
    {
      name: "empty",
      state: {
        data: {
          requestId: "request-empty",
          generatedAt: "2026-07-11T12:00:00.000Z",
          items: [],
          sourceStatus: [],
          allSourcesFailed: false,
        },
        error: undefined,
        isLoading: false,
      },
      expected: "No runs found",
    },
    {
      name: "total source failure",
      state: {
        data: {
          requestId: "request-failed",
          generatedAt: "2026-07-11T12:00:00.000Z",
          items: [],
          sourceStatus: [
            {
              source: "background_agent",
              status: "failed",
              itemCount: 0,
              safeErrorKind: "source_unavailable",
            },
            {
              source: "agent_loop",
              status: "failed",
              itemCount: 0,
              safeErrorKind: "source_unavailable",
            },
          ],
          allSourcesFailed: true,
        },
        error: new Error("Runs sources unavailable"),
        isLoading: false,
      },
      expected: "Could not load run history",
    },
  ])("renders the $name state explicitly", async ({ state, expected }) => {
    swrState = state;
    const { RunsList } = await componentPromise;
    const html = renderToStaticMarkup(<RunsList searchParams="view=active" />);
    expect(html).toContain(expected);
  });
});
