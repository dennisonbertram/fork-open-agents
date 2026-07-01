import { describe, expect, test } from "bun:test";
import { classifyGtmActivationSignals } from "./classifier";

describe("GTM activation classifier", () => {
  test("detects stuck onboarding, repeated failures, objections, and product requests", () => {
    const signals = classifyGtmActivationSignals([
      {
        targetUserHash: "user-hash-1",
        githubInstalled: false,
        failureCount: 3,
        objectionText: "Security review is a blocker",
        featureRequestText: "Need Linear integration",
      },
      {
        targetUserHash: "user-hash-2",
        githubInstalled: true,
        sessionCount: 0,
      },
    ]);

    expect(signals.map((signal) => signal.signalType)).toEqual([
      "github_not_installed",
      "repeated_session_failure",
      "explicit_objection",
      "product_request",
      "no_first_session",
    ]);
    expect(signals[1]?.severity).toBe("high");
    expect(signals[3]?.draftIssue.title).toContain("product request");
  });

  test("dedupes duplicate source candidates inside one scan", () => {
    const signals = classifyGtmActivationSignals([
      { targetUserHash: "user-hash-1", githubInstalled: false },
      { targetUserHash: "user-hash-1", githubInstalled: false },
    ]);

    expect(signals).toHaveLength(1);
  });
});
