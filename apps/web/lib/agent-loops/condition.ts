/**
 * Agent Loops — condition evaluation
 *
 * evaluateCondition(condition, context) →
 *   { ok: true; result: boolean }
 *   | { ok: false; errorKind: "condition_path_missing" | "condition_type_mismatch" }
 *
 * Ops:
 *   eq / neq   — deep-equal for primitives; no type coercion; type mismatch → error
 *   gt/gte/lt/lte — numbers only; strings or mixed → condition_type_mismatch
 *   exists     — found check only (null counts as present)
 *   contains   — string includes substring OR array includes value; other types → type mismatch
 *
 * Missing path → condition_path_missing (NEVER a silent false).
 *
 * No I/O, no DB, no eval.
 */

import { lookupContextPath } from "./context";
import type { Condition } from "./types";

export type EvaluateConditionResult =
  | { ok: true; result: boolean }
  | {
      ok: false;
      errorKind: "condition_path_missing" | "condition_type_mismatch";
    };

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(result: boolean): EvaluateConditionResult {
  return { ok: true, result };
}

function missingPath(): EvaluateConditionResult {
  return { ok: false, errorKind: "condition_path_missing" };
}

function typeMismatch(): EvaluateConditionResult {
  return { ok: false, errorKind: "condition_type_mismatch" };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Evaluates a structured condition against a run context.
 * Returns a typed result — NEVER throws.
 */
export function evaluateCondition(
  condition: Condition,
  context: Record<string, unknown>,
): EvaluateConditionResult {
  const { path, op, value: condValue } = condition;

  // exists is the only op that treats missing path as an error (same as the
  // rest, but the lookup is the source of truth — null counts as found).
  if (op === "exists") {
    const lookup = lookupContextPath(context, path);
    if (!lookup.found) {
      return missingPath();
    }
    return ok(true);
  }

  // All other ops require the path to be present
  const lookup = lookupContextPath(context, path);
  if (!lookup.found) {
    return missingPath();
  }

  const ctxValue = lookup.value;

  switch (op) {
    case "eq": {
      if (typeof ctxValue !== typeof condValue) {
        return typeMismatch();
      }
      return ok(ctxValue === condValue);
    }

    case "neq": {
      if (typeof ctxValue !== typeof condValue) {
        return typeMismatch();
      }
      return ok(ctxValue !== condValue);
    }

    case "gt": {
      if (typeof ctxValue !== "number" || typeof condValue !== "number") {
        return typeMismatch();
      }
      return ok(ctxValue > condValue);
    }

    case "gte": {
      if (typeof ctxValue !== "number" || typeof condValue !== "number") {
        return typeMismatch();
      }
      return ok(ctxValue >= condValue);
    }

    case "lt": {
      if (typeof ctxValue !== "number" || typeof condValue !== "number") {
        return typeMismatch();
      }
      return ok(ctxValue < condValue);
    }

    case "lte": {
      if (typeof ctxValue !== "number" || typeof condValue !== "number") {
        return typeMismatch();
      }
      return ok(ctxValue <= condValue);
    }

    case "contains": {
      if (typeof ctxValue === "string") {
        if (typeof condValue !== "string") {
          // String container, non-string needle — still works via coercion,
          // but spec says "string includes substring" so we require string.
          // Any non-string needle in a string container is a type mismatch.
          return typeMismatch();
        }
        return ok(ctxValue.includes(condValue));
      }
      if (Array.isArray(ctxValue)) {
        return ok(ctxValue.includes(condValue));
      }
      // Number, object, boolean, null, etc. → type mismatch
      return typeMismatch();
    }

    default: {
      // TypeScript exhaustiveness guard — should never reach here
      const _exhaustive: never = op;
      return typeMismatch();
    }
  }
}
