import { describe, expect, test } from "bun:test";
import { buildAccountBriefDraft, inferSignalKind } from "./brief";

describe("GTM research brief", () => {
  test("keeps cited claims as draft signal candidates and rejects uncited claims", () => {
    const brief = buildAccountBriefDraft({
      accountName: "Acme",
      claims: [
        {
          text: "Acme has a pain around approval-safe agents",
          evidenceRefs: [
            {
              sourceType: "public_url",
              url: "https://example.com/acme",
              retrievedAt: "2026-07-01T00:00:00.000Z",
              excerpt: "approval-safe agents",
            },
          ],
        },
        {
          text: "Acme privately churned from a competitor",
          privateFact: true,
        },
      ],
      openQuestions: ["Who owns the rollout?"],
      nextSteps: ["Draft founder follow-up"],
    });

    expect(brief.citedFacts).toHaveLength(1);
    expect(brief.unknownClaims).toEqual([
      {
        text: "Acme privately churned from a competitor",
        reason: "missing_required_citation",
      },
    ]);
    expect(brief.signalCandidates).toEqual([
      expect.objectContaining({
        kind: "pain",
        status: "draft",
        summary: "Acme has a pain around approval-safe agents",
      }),
    ]);
  });

  test("marks public-source private claims unknown instead of treating them as fact", () => {
    const brief = buildAccountBriefDraft({
      claims: [
        {
          text: "The buyer has a private budget concern",
          privateFact: true,
          evidenceRefs: [
            {
              sourceType: "public_url",
              url: "https://example.com",
            },
          ],
        },
      ],
    });

    expect(brief.citedFacts).toEqual([]);
    expect(brief.unknownClaims).toEqual([
      {
        text: "The buyer has a private budget concern",
        reason: "private_fact_unverified",
      },
    ]);
  });

  test("does not count malformed evidence refs as citations", () => {
    const brief = buildAccountBriefDraft({
      claims: [
        {
          text: "Acme wants a product-led rollout",
          evidenceRefs: [{} as never],
        },
        {
          text: "Acme uses GitHub",
          evidenceRefs: [{ sourceType: "github", recordId: "repo-1" }],
        },
      ],
    });

    expect(brief.citedFacts).toEqual([
      expect.objectContaining({
        text: "Acme uses GitHub",
        evidenceRefs: [{ sourceType: "github", recordId: "repo-1" }],
      }),
    ]);
    expect(brief.unknownClaims).toEqual([
      {
        text: "Acme wants a product-led rollout",
        reason: "missing_required_citation",
      },
    ]);
  });

  test("redacts secret-looking research text", () => {
    const brief = buildAccountBriefDraft({
      claims: [
        {
          text: "token=secret",
          evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
        },
      ],
    });

    expect(brief.citedFacts[0]?.text).toMatch("[redacted:");
    expect(brief.signalCandidates[0]?.summary).toMatch("[redacted:");
  });

  test("infers bounded signal kinds", () => {
    expect(inferSignalKind("recent funding announcement")).toBe("funding");
    expect(inferSignalKind("job post says hiring platform engineer")).toBe(
      "hiring",
    );
    expect(inferSignalKind("objection about security review")).toBe(
      "objection",
    );
  });
});
