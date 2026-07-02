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

const componentModulePromise = import("./weekly-review-client");

describe("GtmWeeklyReviewClient", () => {
  beforeEach(() => {
    swrState = {};
    mutate.mockClear();
  });

  test("renders approved learning context from the API", async () => {
    swrState = {
      data: {
        learnings: [
          {
            learningId: "learning-1",
            title: "Founder DMs work for infra founders",
            summary: "Manual founder outreach produced qualified replies.",
            confidence: "medium",
            sourceId: "run-1",
            evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    };
    const { GtmWeeklyReviewClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmWeeklyReviewClient />);

    expect(html).toContain("Founder DMs work for infra founders");
    expect(html).toContain(
      "Manual founder outreach produced qualified replies",
    );
    expect(html).toContain("1 evidence refs");
  });

  test("renders an empty review and learning state", async () => {
    swrState = { data: { learnings: [] } };
    const { GtmWeeklyReviewClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmWeeklyReviewClient />);

    expect(html).toContain("No review run selected");
    expect(html).toContain("No approved GTM learnings yet");
  });

  test("renders experiment summaries, source gaps, next bets, and candidates", async () => {
    const { ReviewResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ReviewResult
        result={{
          reviewRunId: "run-1",
          status: "partial",
          experimentSummaries: [
            {
              experimentId: "experiment-1",
              title: "Founder DM test",
              hypothesis: "Founder-led DMs create qualified demos",
              channel: "linkedin",
              owner: "founder",
              metricSummary: [{ key: "replies", value: 3 }],
              qualitativeSignals: ["3 replies from 20 DMs"],
              evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
            },
          ],
          sourceGaps: [
            {
              experimentId: "experiment-1",
              sourceKind: "metrics",
              errorKind: "metric_source_unavailable",
              message: "No analytics export connected.",
            },
          ],
          nextBets: [
            {
              title: "Follow up on Founder DM test",
              rationale: "Recent linkedin experiment reported replies: 3.",
              confidence: "medium",
              evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
            },
          ],
          learningCandidates: [
            {
              candidateKey: "experiment-1",
              experimentId: "experiment-1",
              title: "Experiment learning: Founder DM test",
              summary: "Manual founder outreach produced replies.",
              confidence: "medium",
              evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
              redactionStatus: "redacted",
              approvalStatus: "pending",
              dedupSignature: "dedup-1",
            },
          ],
          approvalIds: ["approval-1"],
          persistedLearningIds: [],
          dedupedCount: 0,
        }}
      />,
    );

    expect(html).toContain("Founder DM test");
    expect(html).toContain("replies: 3");
    expect(html).toContain("metric_source_unavailable");
    expect(html).toContain("Follow up on Founder DM test");
    expect(html).toContain("Experiment learning: Founder DM test");
    expect(html).toContain("pending");
  });
});
