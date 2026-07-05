/**
 * No-progress (git-delta) budget for background-agent runs (#914).
 *
 * Pure, sandbox/DB-free tracker: given a per-turn "fingerprint" of the
 * sandbox's git working tree (see probeGitFingerprint in executor.ts), it
 * counts consecutive turns where the fingerprint did not change and signals
 * when that streak reaches the configured cap. This replaces a fixed total
 * turn count as the *primary* budget — a long-running but genuinely
 * productive run (fingerprint changing every turn) never trips it, while a
 * stalled run (same fingerprint turn after turn) is caught quickly.
 *
 * `ProgressVerdict` deliberately leaves room for a future `"nudge"` /
 * `"escalate"` state (background-agents-epic Task 3) without a breaking
 * change to this module's shape.
 */
export type ProgressVerdict = "continue" | "stop";

export type ProgressObservation = {
  /** Consecutive turns (including this one) with no fingerprint change. */
  staleTurns: number;
  /** Whether the fingerprint changed relative to the previous observation. */
  changed: boolean;
  verdict: ProgressVerdict;
};

export function createProgressBudget(config: {
  maxStaleTurns: number;
  /**
   * Fingerprint captured before the turn loop starts (e.g. from the sandbox
   * setup git probe). Omit when no pre-loop probe was taken — the first
   * `observeTurn` call then seeds the baseline instead of comparing against
   * it.
   */
  initialFingerprint?: string | null;
}): {
  observeTurn(input: { gitFingerprint: string | null }): ProgressObservation;
} {
  let previousFingerprint: string | null | undefined = config.initialFingerprint;
  let staleTurns = 0;

  function verdictFor(count: number): ProgressVerdict {
    return count >= config.maxStaleTurns ? "stop" : "continue";
  }

  return {
    observeTurn(input) {
      const { gitFingerprint } = input;

      // The git probe failed or was skipped: treat as "unknown, not stale"
      // rather than penalizing the run for a sandbox/tooling hiccup.
      if (gitFingerprint === null) {
        return {
          staleTurns,
          changed: false,
          verdict: verdictFor(staleTurns),
        };
      }

      // No baseline established yet — this observation becomes the baseline.
      if (previousFingerprint === undefined) {
        previousFingerprint = gitFingerprint;
        staleTurns = 0;
        return { staleTurns, changed: true, verdict: verdictFor(staleTurns) };
      }

      if (previousFingerprint === gitFingerprint) {
        staleTurns += 1;
        return { staleTurns, changed: false, verdict: verdictFor(staleTurns) };
      }

      previousFingerprint = gitFingerprint;
      staleTurns = 0;
      return { staleTurns, changed: true, verdict: verdictFor(staleTurns) };
    },
  };
}
