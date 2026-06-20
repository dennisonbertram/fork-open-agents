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
    message: () => undefined,
  },
}));

const componentModulePromise = import("./learnings-section");

describe("LearningsSection", () => {
  beforeEach(() => {
    swrState = {};
    mutate.mockClear();
  });

  test("renders the empty state with enable CTA when a repo has no learnings", async () => {
    swrState = {
      data: {
        enabled: false,
        verdict: {
          status: "action-needed",
          headline: "Learnings agent off",
          detail: "Enable it to extract learnings from pull requests.",
        },
        learnings: [],
      },
    };
    const { LearningsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <LearningsSection initialRepoOwner="acme" initialRepoName="widgets" />,
    );

    expect(html).toContain("No learnings yet");
    expect(html).toContain("Enable");
    expect(html).toContain("Learnings agent off");
  });

  test("renders the feed table controls and archive affordance for active learnings", async () => {
    swrState = {
      data: {
        enabled: true,
        verdict: {
          status: "ready",
          headline: "Learnings agent enabled",
          detail: "The learnings agent watches merged pull requests.",
        },
        learnings: [
          {
            id: "learning-1",
            repoOwner: "acme",
            repoName: "widgets",
            type: "bug",
            scope: "repo",
            title: "Keep route updates owner-scoped",
            description: "Always include the user id when mutating rows.",
            rootCause: "A previous route trusted the id alone.",
            solution: "Read the row, verify owner, then patch.",
            prevention: "Add non-owner tests for every mutation route.",
            affectedPaths: ["apps/web/app/api/learnings/[learningId]/route.ts"],
            tags: ["api"],
            severity: "high",
            confidence: "high",
            status: "active",
            sourcePrNumber: 275,
            sourcePrUrl: "https://github.com/acme/widgets/pull/275",
            committedFilePath: null,
            createdAt: "2026-06-19T12:00:00.000Z",
            updatedAt: "2026-06-19T12:15:00.000Z",
            evidence: [
              {
                id: "evidence-1",
                kind: "pr_url",
                ref: "https://github.com/acme/widgets/pull/275",
                excerpt: "PR evidence",
              },
            ],
          },
        ],
      },
    };
    const { LearningsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <LearningsSection initialRepoOwner="acme" initialRepoName="widgets" />,
    );

    expect(html).toContain("Filter learnings");
    expect(html).toContain("Keep route updates owner-scoped");
    expect(html).toContain("Archive");
    expect(html).toContain("AI-derived");
  });

  test("renders an inline error with retry when the feed request fails", async () => {
    swrState = { error: new Error("load failed") };
    const { LearningsSection } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <LearningsSection initialRepoOwner="acme" initialRepoName="widgets" />,
    );

    expect(html).toContain("Failed to load learnings.");
    expect(html).toContain("Retry");
    expect(html).toContain("Operator details");
  });
});
