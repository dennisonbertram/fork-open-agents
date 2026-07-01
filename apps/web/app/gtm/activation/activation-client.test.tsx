import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type SwrState = {
  data?: unknown;
  error?: Error | null;
  isLoading?: boolean;
};

let swrState: SwrState = {};
const mutate = mock(async () => undefined);

mock.module("swr", () => ({
  default: () => ({
    data: swrState.data,
    error: swrState.error ?? null,
    isLoading: swrState.isLoading ?? false,
    mutate,
  }),
}));

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const componentModulePromise = import("./activation-client");

describe("GtmActivationClient", () => {
  beforeEach(() => {
    swrState = {};
    mutate.mockClear();
  });

  test("renders watcher inputs and empty queue state", async () => {
    swrState = { data: { signals: [] } };
    const { GtmActivationClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmActivationClient />);

    expect(html).toContain("Target user hash");
    expect(html).toContain("Run watcher");
    expect(html).toContain("No activation signals");
  });

  test("renders activation queue items with issue drafts", async () => {
    const { ActivationQueue } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ActivationQueue
        signals={[
          {
            signalId: "signal-1",
            approvalId: "approval-1",
            signalType: "activation",
            severity: "high",
            summary: "3 session failures suggest activation is blocked.",
            evidenceRefs: [{ sourceType: "product", recordId: "event-1" }],
            updatedAt: "2026-07-01T00:00:00.000Z",
            metadata: {
              signalType: "repeated_session_failure",
              suggestedIntervention: "Review failed sessions.",
              draftIssue: {
                title: "[Activation] repeated session failure",
                body: "Suggested intervention: Review failed sessions.",
              },
            },
          },
        ]}
      />,
    );

    expect(html).toContain("repeated_session_failure");
    expect(html).toContain("3 session failures");
    expect(html).toContain("Review failed sessions");
    expect(html).toContain("[Activation] repeated session failure");
    expect(html).toContain("pending approval");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
  });

  test("renders watcher run summary", async () => {
    const { ActivationRunResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ActivationRunResult
        result={{
          runId: "run-1",
          signalIds: ["signal-1"],
          approvalIds: ["approval-1"],
          dedupedCount: 2,
        }}
      />,
    );

    expect(html).toContain("1 signals");
    expect(html).toContain("1 issue");
    expect(html).toContain("2 deduped");
  });
});
