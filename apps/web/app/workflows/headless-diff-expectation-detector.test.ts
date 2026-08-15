import { describe, expect, test } from "bun:test";
import { createHeadlessDiffExpectationDetector } from "./headless-diff-expectation-detector";

/**
 * #1288: circling detection for a headless run declared to change files.
 * Reuses the same per-step git-only fingerprint the no-progress fuse already
 * probes (headless-progress-detector.ts uses the COMBINED git+tool
 * fingerprint; this detector deliberately uses the git-only half, since a
 * declared-to-change-files run must be judged on whether the workspace
 * actually changed, not on tool-call variety — that is exactly the #1242
 * carve-out this circumvents for a run that promised a diff).
 */
describe("createHeadlessDiffExpectationDetector (#1288)", () => {
  test("continues on the first observation, one step below a 1-step allowance", () => {
    const detector = createHeadlessDiffExpectationDetector({ allowance: 2 });
    expect(detector.observeTurn({ fingerprint: "fp-1" })).toEqual({
      verdict: "continue",
    });
  });

  test("continues indefinitely while the fingerprint keeps changing", () => {
    const detector = createHeadlessDiffExpectationDetector({ allowance: 3 });
    for (let i = 0; i < 10; i++) {
      expect(detector.observeTurn({ fingerprint: `fp-${i}` }).verdict).toBe(
        "continue",
      );
    }
  });

  // The allowance counts TOTAL observations of the same value — matching
  // headless-progress-detector.ts's own repeatThreshold convention, so a run
  // configured with `allowance: N` stops after exactly N steps of no
  // git-tree change, never N+1.
  test("stops on the Nth consecutive observation of the same fingerprint", () => {
    const detector = createHeadlessDiffExpectationDetector({ allowance: 3 });
    expect(detector.observeTurn({ fingerprint: "fp-1" }).verdict).toBe(
      "continue",
    ); // 1st
    expect(detector.observeTurn({ fingerprint: "fp-1" }).verdict).toBe(
      "continue",
    ); // 2nd
    const observation = detector.observeTurn({ fingerprint: "fp-1" }); // 3rd
    expect(observation).toEqual({ verdict: "stop", stepsWithoutChange: 3 });
  });

  test("a change resets the streak, so the allowance restarts", () => {
    const detector = createHeadlessDiffExpectationDetector({ allowance: 3 });
    detector.observeTurn({ fingerprint: "fp-1" }); // 1st of fp-1
    detector.observeTurn({ fingerprint: "fp-1" }); // 2nd of fp-1
    detector.observeTurn({ fingerprint: "fp-2" }); // changed — restarts at 1
    const observation = detector.observeTurn({ fingerprint: "fp-2" }); // 2nd of fp-2, still under 3
    expect(observation).toEqual({ verdict: "continue" });
  });

  test("a null fingerprint (probe failure) does not count against the allowance", () => {
    const detector = createHeadlessDiffExpectationDetector({ allowance: 2 });
    detector.observeTurn({ fingerprint: "fp-1" }); // 1st of fp-1
    // A transient probe failure — must not push the run over the allowance
    // by itself, matching the no-progress fuse's own null carve-out.
    expect(detector.observeTurn({ fingerprint: null }).verdict).toBe(
      "continue",
    );
    const observation = detector.observeTurn({ fingerprint: "fp-1" }); // 2nd of fp-1
    expect(observation).toEqual({ verdict: "stop", stepsWithoutChange: 2 });
  });
});
