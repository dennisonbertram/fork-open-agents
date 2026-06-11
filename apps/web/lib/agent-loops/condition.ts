/**
 * Agent Loops — condition evaluation (STUB for TDD red state)
 *
 * DO NOT IMPLEMENT YET — this stub provides the correct type signatures so
 * the test suite can exercise behavioral failures instead of import errors.
 */

import type { Condition } from "./types";

export type EvaluateConditionResult =
  | { ok: true; result: boolean }
  | { ok: false; errorKind: "condition_path_missing" | "condition_type_mismatch" };

/**
 * Evaluates a structured condition against a run context.
 * Returns a typed result — NEVER throws.
 */
export function evaluateCondition(
  _condition: Condition,
  _context: Record<string, unknown>,
): EvaluateConditionResult {
  // STUB
  return { ok: false, errorKind: "condition_path_missing" };
}
