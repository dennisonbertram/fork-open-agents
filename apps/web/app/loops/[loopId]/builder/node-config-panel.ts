/**
 * node-config-panel.ts — helpers for the node config panel.
 *
 * Stub — implementation in M2-02.
 */

import type { ConditionOp, LoopValidationError } from "@/lib/agent-loops/types";

/**
 * Given a list of validation errors, returns a map of nodeId → errors for
 * that node. Only includes errors that have a nodeId (node-scoped errors).
 */
export function nodeErrorsById(
  _errors: LoopValidationError[],
): Record<string, LoopValidationError[]> {
  throw new Error("not implemented");
}

/**
 * Returns whether the value field should be visible for the given condition op.
 * 'exists' does not require a value; all other ops do.
 */
export function conditionValueVisible(_op: ConditionOp): boolean {
  throw new Error("not implemented");
}

/**
 * Returns the HTML input type for the condition value field based on the op.
 * gt/gte/lt/lte → 'number'; all others → 'text'.
 */
export function conditionValueType(_op: ConditionOp): "number" | "text" {
  throw new Error("not implemented");
}

/**
 * Clamps a guardrail field value to its server-enforced ceiling.
 * If no ceiling exists for the field, returns the value unchanged.
 */
export function clampGuardrailField(
  _field: "maxStepsPerRun" | "maxIterations" | "maxRunDurationMs" | "stepTimeoutMs",
  _value: number,
): number {
  throw new Error("not implemented");
}
