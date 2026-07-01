import { describe, expect, test } from "bun:test";
import { buildGtmCallBrief, buildGtmCallDebrief } from "./extraction";

describe("GTM call extraction", () => {
  test("builds a bounded call prep brief from known context", () => {
    const brief = buildGtmCallBrief({
      founderObjective: "Validate whether Acme can use approval-gated agents",
      knownContext: ["Acme is evaluating agent workflow governance."],
      openLoops: ["Security owner is unknown."],
      desiredOutcome: "Agree on a pilot.",
    });

    expect(brief.objective).toContain("approval-gated agents");
    expect(brief.conciseBrief).toContain("workflow governance");
    expect(brief.risks).toEqual(["Unresolved: Security owner is unknown."]);
    expect(brief.suggestedQuestions.length).toBeGreaterThan(0);
  });

  test("extracts debrief next steps, objections, and product asks", () => {
    const debrief = buildGtmCallDebrief({
      attendees: ["Morgan"],
      notes:
        "Morgan is excited about the workflow. Concern is security review. Next we will send a pilot plan. Product request: Slack approval integration.",
    });

    expect(debrief.sentiment).toBe("negative");
    expect(debrief.nextSteps[0]?.summary).toContain("send a pilot plan");
    expect(debrief.objections[0]).toContain("security review");
    expect(debrief.productAsks).toContainEqual(
      expect.stringContaining("Slack approval integration"),
    );
    expect(debrief.proposedActions).toHaveLength(2);
  });

  test("rejects oversized transcripts", () => {
    expect(() => buildGtmCallDebrief({ notes: "x".repeat(20_001) })).toThrow(
      "transcript_too_large",
    );
  });
});
