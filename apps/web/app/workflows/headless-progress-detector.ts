import {
  detectRepetition,
  type RepetitionVerdict,
} from "@/lib/background-agents/repetition-detector";
import { NO_TOOL_ACTIVITY_SIGNATURE } from "./headless-activity-signal";

/**
 * #1242 follow-up: the composite (git + tool-call) fingerprint from
 * `headless-activity-signal.ts` only caught a STRICT trailing repeat — the
 * combined fingerprint identical to the one before it. An agent alternating
 * between two (or three) distinct read calls with a frozen git tree — "read
 * file A, read file B, repeat" — produces a combined fingerprint that
 * differs every step, so the adjacent-only comparison never flagged it.
 * That is an unbounded headless run: `maxSteps` is undefined by design
 * (#1231), the no-sandbox cap does not apply (a sandbox exists), so nothing
 * else stops it before the 90-minute sandbox ceiling.
 *
 * This module keeps a bounded window of the SAME combined fingerprints
 * `chat.ts` already builds and reuses `detectRepetition` (#915,
 * `lib/background-agents/repetition-detector.ts` — a pure, zero-import
 * module, safe from the workflow VM) to catch both shapes:
 *  - "repeat": the trailing N combined fingerprints are identical (the
 *    original #1231 case, and the plain "call the same tool over and over"
 *    #1242 wedge).
 *  - "cycle": a short block of 2..maxCyclePeriod fingerprints repeats
 *    cycleRepeats+ times (the A/B/A/B case this follow-up closes).
 *
 * Feeding the COMBINED (git+tool) fingerprint, not the tool signature
 * alone, is what keeps the "a file-changing run is never stopped" guarantee
 * intact for free: a run that is really changing files produces a
 * different combined fingerprint on (almost) every step, so neither arm can
 * ever find a repeating run or a repeating block — there is never a
 * matching pair to repeat.
 */
export type HeadlessProgressReason = "stalled_tree" | "repeat" | "cycle";

export type HeadlessProgressObservation =
  | { verdict: "continue" }
  | {
      verdict: "stop";
      reason: HeadlessProgressReason;
      /** Trailing identical-fingerprint run length (repeat/stalled_tree) or the repeat run detectRepetition also tracks alongside a cycle flag. */
      repeatCount: number;
      /** Cycle period, set only when reason === "cycle". */
      cycleLength: number | null;
    };

const NO_ACTIVITY_SUFFIX = `::${NO_TOOL_ACTIVITY_SIGNATURE}`;

export function createHeadlessProgressDetector(config: {
  /** Trailing identical-fingerprint run length that flags "repeat"/"stalled_tree" — same knob as before (HEADLESS_RUN_MAX_STALE_STEPS). */
  repeatThreshold: number;
  /** Cycle period search range (2..maxCyclePeriod). Default 3 — covers both required shapes (A/B/A/B and a 3-call cycle) without searching arbitrarily long patterns that are unlikely to be a real wedge. */
  maxCyclePeriod?: number;
  /** How many times a period-p block must repeat before it's flagged. Default 2 — the shortest evidence that it's a repeating pattern rather than a coincidence. */
  cycleRepeats?: number;
}): {
  observeTurn(input: {
    fingerprint: string | null;
  }): HeadlessProgressObservation;
} {
  const cycleRepeats = config.cycleRepeats ?? 2;
  const maxCyclePeriod = config.maxCyclePeriod ?? 3;
  // The window only needs to hold enough history for the hungrier of the two
  // checks — the repeat arm (repeatThreshold entries) or the cycle arm
  // (maxCyclePeriod * cycleRepeats entries). Deriving it instead of adding a
  // fifth env knob means it can never silently disagree with the other two.
  const windowCap = Math.max(
    config.repeatThreshold,
    maxCyclePeriod * cycleRepeats,
  );
  const recent: string[] = [];

  return {
    observeTurn({ fingerprint }): HeadlessProgressObservation {
      // Probe failure: unknown, not stale — matches the original
      // createProgressBudget carve-out. Skip the window so a transient
      // hiccup can never itself complete (or silently continue) a
      // repeat/cycle streak.
      if (fingerprint === null) {
        return { verdict: "continue" };
      }

      recent.push(fingerprint);
      if (recent.length > windowCap) {
        recent.shift();
      }

      const verdict: RepetitionVerdict = detectRepetition(recent, {
        repeatThreshold: config.repeatThreshold,
        cycleRepeats,
        maxCyclePeriod,
      });

      if (!verdict.flagged) {
        return { verdict: "continue" };
      }

      if (verdict.reason === "cycle") {
        return {
          verdict: "stop",
          reason: "cycle",
          repeatCount: verdict.repeatCount,
          cycleLength: verdict.cycleLength,
        };
      }

      const stalled = recent.at(-1)?.endsWith(NO_ACTIVITY_SUFFIX) ?? false;
      return {
        verdict: "stop",
        reason: stalled ? "stalled_tree" : "repeat",
        repeatCount: verdict.repeatCount,
        cycleLength: null,
      };
    },
  };
}
