import { describe, expect, test } from "bun:test";
import { createHeadlessProgressDetector } from "./headless-progress-detector";

const NO_ACTIVITY = "∅";

function observeAll(
  detector: ReturnType<typeof createHeadlessProgressDetector>,
  fingerprints: Array<string | null>,
) {
  let last: ReturnType<typeof detector.observeTurn> | undefined;
  for (const fingerprint of fingerprints) {
    last = detector.observeTurn({ fingerprint });
    if (last.verdict === "stop") {
      return last;
    }
  }
  return last;
}

describe("createHeadlessProgressDetector (#1242 follow-up)", () => {
  test("flags a strict trailing repeat once it reaches repeatThreshold", () => {
    const detector = createHeadlessProgressDetector({ repeatThreshold: 3 });
    const same = `git-1::task\x00{"task":"list"}`;
    const result = observeAll(detector, [same, same, same]);
    expect(result?.verdict).toBe("stop");
    if (result?.verdict === "stop") {
      expect(result.reason).toBe("repeat");
      expect(result.repeatCount).toBe(3);
    }
  });

  test("names a strict trailing repeat with no tool activity as stalled_tree", () => {
    const detector = createHeadlessProgressDetector({ repeatThreshold: 3 });
    const frozen = `git-1::${NO_ACTIVITY}`;
    const result = observeAll(detector, [frozen, frozen, frozen]);
    expect(result?.verdict).toBe("stop");
    if (result?.verdict === "stop") {
      expect(result.reason).toBe("stalled_tree");
    }
  });

  test("flags an A/B/A/B period-2 cycle once it repeats cycleRepeats times", () => {
    const detector = createHeadlessProgressDetector({
      repeatThreshold: 100, // high enough that only the cycle arm can fire
      cycleRepeats: 2,
      maxCyclePeriod: 3,
    });
    const a = `git-1::task\x00{"file":"A"}`;
    const b = `git-1::task\x00{"file":"B"}`;
    const result = observeAll(detector, [a, b, a, b]);
    expect(result?.verdict).toBe("stop");
    if (result?.verdict === "stop") {
      expect(result.reason).toBe("cycle");
      expect(result.cycleLength).toBe(2);
    }
  });

  test("flags a three-call A/B/C period-3 cycle", () => {
    const detector = createHeadlessProgressDetector({
      repeatThreshold: 100,
      cycleRepeats: 2,
      maxCyclePeriod: 3,
    });
    const a = `git-1::task\x00{"file":"A"}`;
    const b = `git-1::task\x00{"file":"B"}`;
    const c = `git-1::task\x00{"file":"C"}`;
    const result = observeAll(detector, [a, b, c, a, b, c]);
    expect(result?.verdict).toBe("stop");
    if (result?.verdict === "stop") {
      expect(result.reason).toBe("cycle");
      expect(result.cycleLength).toBe(3);
    }
  });

  test("never flags a long run of genuinely distinct fingerprints", () => {
    const detector = createHeadlessProgressDetector({
      repeatThreshold: 5,
      cycleRepeats: 2,
      maxCyclePeriod: 3,
    });
    const fingerprints = Array.from(
      { length: 40 },
      (_, i) => `git-1::task\x00{"pr":${i}}`,
    );
    const result = observeAll(detector, fingerprints);
    expect(result?.verdict).toBe("continue");
  });

  test("a probe failure (null fingerprint) is unknown-not-stale and does not extend a streak", () => {
    const detector = createHeadlessProgressDetector({ repeatThreshold: 3 });
    const same = `git-1::task\x00{"task":"list"}`;
    // Two identical observations, a probe failure, then a third identical —
    // the failure must not itself complete (or silently continue) the
    // trailing-repeat streak in a way that changes the outcome from feeding
    // the three identical fingerprints back-to-back.
    const withGap = observeAll(detector, [same, same, null]);
    expect(withGap?.verdict).toBe("continue");

    const third = detector.observeTurn({ fingerprint: same });
    expect(third.verdict).toBe("stop");
  });
});
