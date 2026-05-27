import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundRunDetailData } from "./background-run-detail";

mock.module("swr", () => ({
  default: <TData,>(
    _key: string,
    _fetcher: unknown,
    options?: { fallbackData?: TData },
  ) => ({
    data: options?.fallbackData,
    error: null,
  }),
}));

const componentModulePromise = import("./background-run-detail");

function detailData(
  overrides: Partial<BackgroundRunDetailData> = {},
): BackgroundRunDetailData {
  return {
    run: {
      id: "run_123",
      status: "running",
      triggerKind: "github.pull_request",
      repoOwner: "acme",
      repoName: "widgets",
      ref: "refs/pull/7/head",
      sha: "abc123",
      branch: "feature/widgets",
      outputKind: "ready_pr",
      outputUrl: "https://github.com/acme/widgets/pull/42",
      sandboxName: "background_agent_run_123",
      errorKind: null,
      errorMessage: null,
      createdAt: "2026-05-27T12:00:00.000Z",
      startedAt: "2026-05-27T12:01:00.000Z",
      finishedAt: null,
    },
    events: [
      {
        id: "event-1",
        eventName: "background-agent.check.completed",
        status: "succeeded",
        summary: "Command passed: bun --bun run ci",
        workflowRunId: "workflow-1",
        sandboxName: "background_agent_run_123",
        errorKind: null,
        payload: {
          command: "bun --bun run ci",
          durationMs: 1234,
          stdout: "all tests passed",
        },
        createdAt: "2026-05-27T12:02:00.000Z",
      },
    ],
    outputs: [
      {
        id: "output-1",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
      },
    ],
    ...overrides,
  };
}

describe("BackgroundRunDetail", () => {
  test("renders proof strip, live timeline evidence, and output actions", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    expect(html).toContain("Background run");
    expect(html).toContain("github.pull_request");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("abc123");
    expect(html).toContain("background_agent_run_123");
    expect(html).toContain("Live timeline");
    expect(html).toContain("Refreshing");
    expect(html).toContain("Command passed: bun --bun run ci");
    expect(html).toContain("background-agent.check.completed");
    expect(html).toContain("bun --bun run ci");
    expect(html).toContain("1234ms");
    expect(html).toContain("all tests passed");
    expect(html).toContain("workflow workflow-1");
    expect(html).toContain("sandbox background_agent_run_123");
    expect(html).toContain("https://github.com/acme/widgets/pull/42");
    expect(html).toContain("ready_pr");
  });

  test("renders typed failure evidence when a run fails", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail
        initialData={detailData({
          run: {
            ...detailData().run,
            status: "failed",
            outputUrl: null,
            errorKind: "checks_failed",
            errorMessage: "Required background-agent check failed.",
            finishedAt: "2026-05-27T12:03:00.000Z",
          },
          events: [
            {
              id: "event-failed",
              eventName: "background-agent.run.failed",
              status: "failed",
              summary: "Required background-agent check failed.",
              workflowRunId: "workflow-1",
              sandboxName: "background_agent_run_123",
              errorKind: "checks_failed",
              payload: {},
              createdAt: "2026-05-27T12:03:00.000Z",
            },
          ],
          outputs: [],
        })}
      />,
    );

    expect(html).toContain("failed");
    expect(html).toContain("checks_failed");
    expect(html).toContain("Required background-agent check failed.");
    expect(html).toContain("background-agent.run.failed");
    expect(html).toContain("No outputs recorded.");
    expect(html).not.toContain("Refreshing");
  });
});
