/**
 * No-progress (git-delta) budget. Originally written for background-agent
 * runs (#914); moved out of `lib/background-agents` and reused unchanged by
 * headless MCP chat runs (#1231) — this module has no background-agent or
 * chat-specific knowledge, so it lives in a neutral top-level `lib` location
 * rather than being owned by (or duplicated for) either feature.
 *
 * Pure, sandbox/DB-free tracker: given an observation's "fingerprint" of the
 * sandbox's git working tree (see `probeGitFingerprint` in
 * `lib/sandbox/git-fingerprint.ts`), it counts consecutive observations where
 * the fingerprint did not change and signals when that streak reaches the
 * configured cap. This replaces a fixed total step/turn count as the
 * *primary* budget — a long-running but genuinely productive run (fingerprint
 * changing every observation) never trips it, while a stalled run (same
 * fingerprint observation after observation) is caught quickly.
 *
 * Callers choose their own observation cadence — see each caller's own
 * comment for why. Background agents observe once per agent turn (one full
 * `openAgent.generate()` call, which — because `openAgent` is configured with
 * `stopWhen: stepCountIs(1)` — is exactly one model step). Headless chat runs
 * mirror that cadence exactly: `runAgentWorkflow`'s step loop is *also* one
 * model step per iteration, so "one observation per step" is the same
 * granularity in both callers, not a coarser or finer sample.
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
  let previousFingerprint: string | null | undefined =
    config.initialFingerprint;
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
