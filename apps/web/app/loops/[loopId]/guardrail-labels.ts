/**
 * guardrail-labels.ts — humanized labels for the loop-detail guardrails
 * sidebar (#767). Renders `maxStepsPerRun` as "Max steps per run" instead
 * of the raw camelCase key.
 *
 * Unknown keys fall back to a spaced-out, capitalized version of the key so
 * a future guardrail field never renders blank or as a raw camelCase token.
 */

const KNOWN_GUARDRAIL_LABELS: Record<string, string> = {
  maxStepsPerRun: "Max steps per run",
  maxIterations: "Max iterations",
  maxRunDurationMs: "Max run duration",
  // stepTimeoutMs is a cumulative agent-invocation time budget, not a
  // per-attempt timeout — "budget" reflects that accurately.
  stepTimeoutMs: "Step time budget",
};

/** Splits a camelCase key into space-separated words, capitalizing the first. */
function humanizeCamelCaseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Returns the humanized label for a guardrail key, falling back to a spaced version. */
export function getGuardrailLabel(key: string): string {
  return KNOWN_GUARDRAIL_LABELS[key] ?? humanizeCamelCaseKey(key);
}
