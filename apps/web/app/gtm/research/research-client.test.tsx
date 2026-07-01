import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const componentModulePromise = import("./research-client");

describe("GtmResearchClient", () => {
  test("renders the research input surface and empty state", async () => {
    const { GtmResearchClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmResearchClient />);

    expect(html).toContain("Research claims");
    expect(html).toContain("Claims without usable citations stay unknown");
    expect(html).toContain("No research run selected");
  });

  test("renders cited facts, unknown claims, and draft signal candidates", async () => {
    const { ResearchResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ResearchResult
        result={{
          runId: "run-1",
          signalIds: ["signal-1"],
          brief: {
            accountName: "Acme Infrastructure",
            contactName: "Jordan Lee",
            citedFacts: [
              {
                text: "Acme is evaluating agentic developer tools.",
                evidenceRefs: [
                  {
                    sourceType: "manual",
                    recordId: "founder-note",
                    excerpt: "Evaluating agentic developer tools.",
                  },
                ],
              },
            ],
            unknownClaims: [
              {
                text: "Budget owner is unconfirmed.",
                reason: "private_fact_unverified",
              },
            ],
            openQuestions: ["Who owns the pilot decision?"],
            nextSteps: ["Confirm the budget owner."],
            signalCandidates: [
              {
                kind: "fit",
                summary: "Acme is evaluating agentic developer tools.",
                confidence: "medium",
                evidenceRefs: [
                  {
                    sourceType: "manual",
                    recordId: "founder-note",
                  },
                ],
                status: "draft",
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain("Acme is evaluating agentic developer tools");
    expect(html).toContain("private_fact_unverified");
    expect(html).toContain("Who owns the pilot decision?");
    expect(html).toContain("Confirm the budget owner.");
    expect(html).toContain("draft");
    expect(html).toContain("signal-1");
  });
});
