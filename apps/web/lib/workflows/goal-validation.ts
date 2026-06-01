/**
 * Goal terminal-state validation service.
 *
 * STUB — implementation pending. All behavioral tests should FAIL against this stub.
 *
 * @remarks
 * **needs_human mapping**: The `needs_human` concept from the issue does NOT
 * correspond to a new schema enum value or DB migration. It maps to the
 * existing non-terminal statuses `awaiting_input` / `blocked` in the
 * workflow_goals status enum. No new enum value or migration is added.
 *
 * **requireEvidence dormant**: `requireEvidence` is currently sourced as
 * `false` everywhere because goals are not yet linked to a proof level (proof
 * levels live on workflow catalog *definitions*, not goals). The evidence rule
 * is therefore intentionally DORMANT until a future slice links proof levels to
 * goals at close-time. This matches the issue's "require evidence refs ... WHERE
 * PROOF LEVEL DEMANDS THEM" language.
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
// validateGoalCompletion — STUB (not yet implemented)
// ---------------------------------------------------------------------------

/**
 * STUB: always returns { ok: true }.
 * Behavioral tests BT-038-002 will fail against this stub.
 */
export function validateGoalCompletion(_input: {
  status: string;
  evidenceRefs: readonly string[];
  requireEvidence: boolean;
}): GoalValidationResult {
  // STUB: returns ok without checking rules — BT-038-002 will fail here
  return { ok: true };
}
