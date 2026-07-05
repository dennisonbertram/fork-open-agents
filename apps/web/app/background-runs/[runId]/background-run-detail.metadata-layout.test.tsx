/**
 * BackgroundRunDetail — terminal-style metadata layout (#895 follow-through).
 *
 * The loop run page's Proof strip / Correlation IDs reflow bug also applies
 * here: the proof-strip section renders `ProofItem` cards in the same
 * content-sized responsive grid, and long ids (workflow run, request id,
 * idempotency key) in the Debug block would make the layout inconsistent
 * with the new terminal-style RunMetadataTable used on the loop run page.
 * This applies the same shared component so both run surfaces match.
 */

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
      source: "github",
      triggerKind: "github.pull_request",
      externalId: "delivery-123",
      idempotencyKey: "agent-1:trigger-1:delivery-123",
      repoOwner: "acme",
      repoName: "widgets",
      ref: "refs/pull/7/head",
      sha: "abc123",
      branch: "feature/widgets",
      prNumber: 7,
      issueNumber: null,
      deploymentUrl: null,
      outputUrl: null,
      sandboxName: "background_agent_run_123",
      requestId: null,
      workflowRunId: null,
      errorKind: null,
      errorMessage: null,
      createdAt: "2026-05-27T12:00:00.000Z",
      startedAt: "2026-05-27T12:01:00.000Z",
      finishedAt: null,
    },
    agent: null,
    events: [],
    outputs: [],
    ...overrides,
  };
}

describe("BackgroundRunDetail metadata layout (#895)", () => {
  test("the proof strip no longer uses the content-sized reflow grid", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    expect(html).not.toContain("sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8");
  });

  test("a long workflowRunId in the Debug block renders in a non-reflowing overflow-x-auto cell", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const longId = "wrun_01KWNBP9FHXHQ4YE77GBX0C1VP4Z9Q2X7K3M5N6";
    const html = renderToStaticMarkup(
      <BackgroundRunDetail
        initialData={detailData({
          run: { ...detailData().run, workflowRunId: longId },
        })}
      />,
    );

    expect(html).toContain(longId);
    expect(html).toContain("overflow-x-auto");
  });

  test("a run missing requestId/workflowRunId still renders those Debug rows with a placeholder", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    expect(html).toContain("Request ID");
    expect(html).toContain("Workflow Run");
    expect(html).toContain("—");
  });
});
