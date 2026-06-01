/**
 * Goal terminal-state validation service.
 *
 * Pure functions — no DB, no side effects, no `any`.
 *
 * Design notes:
 *
 * needs_human mapping: The `needs_human` concept from issue #38 does NOT
 * correspond to a new schema enum value or DB migration. It maps to the
 * existing non-terminal statuses `awaiting_input` / `blocked` in the
 * workflow_goals status enum. No new enum value or migration is added.
 *
 * requireEvidence dormant: `requireEvidence` is currently sourced as
 * `false` everywhere because goals are not yet linked to a proof level (proof
 * levels live on workflow catalog definitions, not goals). The evidence rule
 * is therefore intentionally DORMANT until a future slice links proof levels to
 * goals at close-time. This matches issue #38's "require evidence refs ...
 * WHERE PROOF LEVEL DEMANDS THEM" language.
 *
 * Terminal-state rule mapping (documented — not schema changes):
 *   "complete"    - terminal; may require evidence when proof level demands it.
 *   "failed"      - terminal; no evidence required.
 *   "canceled"    - terminal; no evidence required.
 *   "archived"    - terminal; no evidence required.
 *   "blocked"     - NON-terminal; maps to awaiting_input/blocked semantics.
 *   "needs_human" - NOT a schema enum value; maps to existing awaiting_input/blocked.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "missing_required_evidence" | "validation_rule_failed";
      reason: string;
    };

// ---------------------------------------------------------------------------
// validateGoalCompletion
// ---------------------------------------------------------------------------

/**
 * Validate a goal before it is closed as "complete".
 *
 * Rules applied (in order):
 *   1. If `status === "complete"` AND `requireEvidence === true` AND
 *      `evidenceRefs.length === 0`, return `{ ok: false, code: "missing_required_evidence" }`.
 *   2. All other cases (non-complete statuses, requireEvidence=false, evidence
 *      present) return `{ ok: true }`.
 *
 * Note: `requireEvidence` is passed as `false` by all current callers because
 * goals are not yet linked to proof levels. This means the evidence rule is
 * dormant in production today. The branch that returns `missing_required_evidence`
 * is tested and exercised by the integration test in chat.test.ts via a forced
 * mock, confirming the wiring is correct.
 */
export function validateGoalCompletion(input: {
  status: string;
  evidenceRefs: readonly string[];
  requireEvidence: boolean;
}): GoalValidationResult {
  if (
    input.status === "complete" &&
    input.requireEvidence &&
    input.evidenceRefs.length === 0
  ) {
    return {
      ok: false,
      code: "missing_required_evidence",
      reason: "A complete goal requires at least one evidence ref.",
    };
  }

  return { ok: true };
}
