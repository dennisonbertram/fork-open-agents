/**
 * turn-budget-proof.ts — pure helper that derives the "Agent turns (per
 * step)" proof-strip item for a loop run failed with errorKind
 * "turn_budget_exceeded" (#862).
 *
 * Client-safe (no server-only imports) so run-detail.tsx can call it
 * directly during render.
 */

import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
} from "@/lib/agent-loops/types";

export type TurnBudgetProof = {
  label: string;
  value: string;
};

/**
 * Returns the turn-budget proof item only when the run's errorKind is
 * "turn_budget_exceeded" — exhaustion implies the used count equals the
 * limit, so there is no separate "used" counter to track. Returns null for
 * every other errorKind so a healthy run never shows a fake counter.
 */
export function getTurnBudgetProof(
  errorKind: string | null | undefined,
  guardrails: { maxAgentTurnsPerStep?: number } | null | undefined,
): TurnBudgetProof | null {
  if (errorKind !== "turn_budget_exceeded") {
    return null;
  }

  const effective = Math.min(
    guardrails?.maxAgentTurnsPerStep ?? GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep,
    GUARDRAIL_CEILINGS.maxAgentTurnsPerStep,
  );

  return {
    label: "Agent turns (per step)",
    value: `${effective} / ${effective}`,
  };
}
