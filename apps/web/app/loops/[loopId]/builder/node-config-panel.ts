/**
 * node-config-panel.ts — pure helper functions for the node config panel.
 *
 * These are importable without React so they can be tested in isolation.
 * The React component is in node-config-panel.tsx.
 */

import type { ConditionOp, LoopValidationError } from "@/lib/agent-loops/types";
import { GUARDRAIL_CEILINGS } from "@/lib/agent-loops/types";

// ── Error derivation ───────────────────────────────────────────────────────────

/**
 * Returns the nodeId associated with a validation error, if any.
 * Global errors (no_start, no_end, end_unreachable, etc.) return undefined.
 */
function nodeIdFromError(error: LoopValidationError): string | undefined {
  switch (error.rule) {
    case "no_outgoing_edge":
    case "missing_condition_edge":
    case "missing_node_config":
    case "missing_condition_value":
    case "forbidden_node_id":
    case "duplicate_node_id":
      return error.nodeId;
    case "multiple_start":
      return error.nodeIds[0];
    default:
      return undefined;
  }
}

/**
 * Given a list of validation errors, returns a map of nodeId → errors for
 * that node. Only includes errors that have a nodeId (node-scoped errors).
 */
export function nodeErrorsById(
  errors: LoopValidationError[],
): Record<string, LoopValidationError[]> {
  const map: Record<string, LoopValidationError[]> = {};
  for (const error of errors) {
    const nodeId = nodeIdFromError(error);
    if (nodeId !== undefined) {
      if (!map[nodeId]) {
        map[nodeId] = [];
      }
      map[nodeId]!.push(error);
    }
  }
  return map;
}

// ── Condition op helpers ───────────────────────────────────────────────────────

/** Ops that do NOT require a value field. */
const VALUE_EXEMPT_OPS = new Set<ConditionOp>(["exists"]);

/** Ops that require a numeric value. */
const NUMERIC_OPS = new Set<ConditionOp>(["gt", "gte", "lt", "lte"]);

/**
 * Returns whether the value field should be visible for the given condition op.
 * 'exists' does not require a value; all other ops do.
 */
export function conditionValueVisible(op: ConditionOp): boolean {
  return !VALUE_EXEMPT_OPS.has(op);
}

/**
 * Returns the HTML input type for the condition value field based on the op.
 * gt/gte/lt/lte → 'number'; all others → 'text'.
 */
export function conditionValueType(op: ConditionOp): "number" | "text" {
  return NUMERIC_OPS.has(op) ? "number" : "text";
}

// ── Guardrail ceiling helpers ─────────────────────────────────────────────────

type GuardrailField =
  | "maxStepsPerRun"
  | "maxIterations"
  | "maxRunDurationMs"
  | "stepTimeoutMs";

/**
 * Clamps a guardrail field value to its server-enforced ceiling.
 * If no ceiling exists for the field (maxRunDurationMs), returns the value unchanged.
 */
export function clampGuardrailField(
  field: GuardrailField,
  value: number,
): number {
  const ceiling = GUARDRAIL_CEILINGS[field];
  if (ceiling === undefined) return value;
  return Math.min(value, ceiling);
}
