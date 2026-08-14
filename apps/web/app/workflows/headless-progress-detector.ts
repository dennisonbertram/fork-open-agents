export type HeadlessProgressReason = "stalled_tree" | "repeat" | "cycle";

export type HeadlessProgressObservation =
  | { verdict: "continue" }
  | {
      verdict: "stop";
      reason: HeadlessProgressReason;
      repeatCount: number;
      cycleLength: number | null;
    };

// TDD stub: intentionally wrong (always "continue") so the red tests fail on
// the assertion, not a missing-module import error. Implemented for green in
// the next commit.
export function createHeadlessProgressDetector(_config: {
  repeatThreshold: number;
  maxCyclePeriod?: number;
  cycleRepeats?: number;
}): {
  observeTurn(input: { fingerprint: string | null }): HeadlessProgressObservation;
} {
  return {
    observeTurn(): HeadlessProgressObservation {
      return { verdict: "continue" };
    },
  };
}
