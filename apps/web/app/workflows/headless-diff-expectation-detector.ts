/**
 * #1288: circling detection for a headless run declared to change files.
 *
 * The no-progress fuse (headless-progress-detector.ts) judges a run on a
 * COMBINED git+tool-call fingerprint — deliberately, per #1242, so a
 * genuinely varied read-only run (review, analysis, reporting) is never
 * stopped merely because the git tree never moves. That is exactly the gap
 * #1288 identified: a run that WAS supposed to produce a diff can burn
 * hundreds of steps issuing varied reads and never trip the fuse, because
 * "no repetition" and "no output" are different things.
 *
 * This detector is the missing, narrower signal: when a caller declares
 * `expectFileChanges: true`, it tracks how many consecutive steps have
 * passed since the git-tree-ONLY fingerprint last actually changed —
 * ignoring tool-call variety entirely — and flags the run once that streak
 * exceeds the configured allowance. It reuses the SAME git fingerprint
 * chat.ts already probes once per step for the no-progress fuse; no extra
 * sandbox call.
 *
 * `allowance` counts total observations of the same value, matching
 * `headless-progress-detector.ts`'s own `repeatThreshold` convention (a
 * window of `repeatThreshold` identical fingerprints flags it — there is no
 * separate free "baseline" step): a run configured with `allowance: 20`
 * stops after exactly 20 steps of no git-tree change, not 21.
 */
export type DiffExpectationObservation =
  | { verdict: "continue" }
  | { verdict: "stop"; stepsWithoutChange: number };

export function createHeadlessDiffExpectationDetector(config: {
  /** Total observations of an unchanged git-tree fingerprint allowed before
   * stopping (the current step counts as one of them). */
  allowance: number;
}): {
  observeTurn(input: {
    fingerprint: string | null;
  }): DiffExpectationObservation;
} {
  // undefined = no baseline probed yet (distinct from null, a probe failure).
  let lastFingerprint: string | null | undefined;
  let stepsWithoutChange = 0;

  return {
    observeTurn({ fingerprint }): DiffExpectationObservation {
      // Probe failure: unknown, not stale — the same carve-out the
      // no-progress fuse uses, so a transient sandbox hiccup can never itself
      // push a run over the allowance.
      if (fingerprint === null) {
        return { verdict: "continue" };
      }

      if (fingerprint === lastFingerprint) {
        stepsWithoutChange += 1;
      } else {
        // A new baseline (including the very first observation) — this step
        // itself is the first occurrence of this value.
        lastFingerprint = fingerprint;
        stepsWithoutChange = 1;
      }

      if (stepsWithoutChange >= config.allowance) {
        return { verdict: "stop", stepsWithoutChange };
      }
      return { verdict: "continue" };
    },
  };
}
