import type { AvailableModelCost } from "@/lib/models";

/**
 * Static role hint labels keyed by model ID.
 * Used by the model picker to show a one-word/short role description per row.
 */
export const MODEL_ROLE_HINTS: Record<string, string> = {
  "openai/gpt-5.4": "Balanced",
  "openai/gpt-5.4-nano": "Fast · Cheap",
  "openai/gpt-5.5": "Premium",
  "anthropic/claude-haiku-4.5": "Fast · Cheap",
  "anthropic/claude-opus-4.6": "Reasoning · 1M ctx",
  "anthropic/claude-sonnet-4-6": "Balanced · 1M ctx",
  "google/gemini-2.5-flash": "Long-context",
  "google/gemini-2.0-flash": "Cheap · 1M ctx",
};

/**
 * Derive a cost-tier glyph from an input price ($/M tokens).
 *
 *   $ = input < 1 $/M
 *  $$ = input 1–5 $/M (inclusive)
 * $$$ = input > 5 $/M
 *
 * Returns undefined when cost or the input field is absent.
 */
export function deriveCostTier(
  cost: Pick<AvailableModelCost, "input" | "output"> | undefined,
): "$" | "$$" | "$$$" | undefined {
  if (!cost || typeof cost.input !== "number") {
    return undefined;
  }
  if (cost.input < 1) {
    return "$";
  }
  if (cost.input <= 5) {
    return "$$";
  }
  return "$$$";
}

/**
 * Return a role hint string for a model.
 * Prefers the static MODEL_ROLE_HINTS map; returns undefined for unknown models.
 */
export function deriveRoleHint(modelId: string): string | undefined {
  return MODEL_ROLE_HINTS[modelId];
}
