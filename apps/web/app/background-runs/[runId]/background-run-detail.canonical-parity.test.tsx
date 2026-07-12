import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundRunDetailData } from "./types";

mock.module("swr", () => ({
  default: <TData,>(
    _key: string | null,
    _fetcher: unknown,
    options?: { fallbackData?: TData },
  ) => ({ data: options?.fallbackData, error: null }),
}));

const detailModule = import("./background-run-detail");

function makeDetail(): BackgroundRunDetailData {
  return {
    run: {
      id: "background-run-1",
      status: "failed",
      source: "github",
      triggerId: "trigger-1",
      triggerKind: "github.pull_request",
      externalId: "delivery-1",
      idempotencyKey: "agent-1:trigger-1:delivery-1",
      repoOwner: "acme",
      repoName: "shop",
      ref: "refs/pull/42/head",
      sha: "abc123",
      branch: "fix/42",
      prNumber: 42,
      issueNumber: null,
      deploymentUrl: null,
      outputUrl: "https://github.com/acme/shop/pull/43",
      sandboxName: "sandbox-1",
      requestId: "request-1",
      workflowRunId: "workflow-1",
      errorKind: "checks_failed",
      errorMessage: "The configured check failed.",
      resultSummary: {
        headline: "Run failed — checks_failed",
        checked: ["bun --bun run ci"],
        changed: [],
        blocked: ["Checks failed"],
        artifacts: [],
        next: ["Fix the check"],
        warnings: [],
      },
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:02:00.000Z",
      startedAt: "2026-07-11T10:01:00.000Z",
      finishedAt: "2026-07-11T10:02:00.000Z",
    },
    agent: {
      id: "agent-1",
      name: "Review pull requests",
      permissions: { github: { contents: "write", checks: "read" } },
      checkConfigured: true,
    },
    events: [
      {
        id: "event-1",
        eventName: "background-agent.check.completed",
        status: "failed",
        summary: "Configured check failed",
        workflowRunId: "workflow-1",
        sandboxName: "sandbox-1",
        requestId: "request-1",
        errorKind: "checks_failed",
        redactionStatus: "failed",
        payload: { stderr: "test failure" },
        createdAt: "2026-07-11T10:02:00.000Z",
      },
    ],
    outputs: [
      {
        id: "output-1",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/shop/pull/43",
        prNumber: 43,
      },
    ],
  };
}

describe("canonical background Run detail parity", () => {
  test("keeps every source-native evidence section inside normalized framing", async () => {
    const { BackgroundRunDetail } = await detailModule;
    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={makeDetail()} variant="canonical" />,
    );

    expect(html).toContain("Single-step Automation run");
    expect(html).toContain("Event context");
    expect(html).toContain("Run summary");
    expect(html).toContain("Live timeline");
    expect(html).toContain("Run");
    expect(html).toContain("Debug");
    expect(html).toContain("Outputs");
    expect(html).toContain("checks_failed");
    expect(html).toContain("redaction failed");
    expect(html).toContain("ready_pr");
    expect(html).toContain("#43");
    expect(html).not.toContain("Pause");
    expect(html).not.toContain("Resume");
    expect(html).not.toContain("Cancel run");
    expect(html).not.toContain("Retry");
  });
});
