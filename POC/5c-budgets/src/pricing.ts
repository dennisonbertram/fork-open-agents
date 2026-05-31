import type { TokenUsage } from "./usage";

/**
 * Per-model price table. USD per 1 token (we store per-million internally and
 * divide) for input, cached input, and output.
 *
 * In the real system the model id is the gateway/provider model id stored on
 * `usage_events.model_id` (apps/web/lib/db/schema.ts). Cached input tokens are
 * billed at a discount, which is why the meter tracks them separately.
 *
 * Prices below are representative public list prices (USD / 1M tokens) as of
 * early 2026 and are intentionally easy to audit. The integration plan notes
 * that this table must be sourced from a maintained config, not hard-coded.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M cached input tokens (discounted). */
  cachedInputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "anthropic/claude-opus-4": {
    inputPerM: 15,
    cachedInputPerM: 1.5,
    outputPerM: 75,
  },
  "anthropic/claude-sonnet-4": {
    inputPerM: 3,
    cachedInputPerM: 0.3,
    outputPerM: 15,
  },
  "anthropic/claude-haiku-4.5": {
    inputPerM: 1,
    cachedInputPerM: 0.1,
    outputPerM: 5,
  },
  "openai/gpt-5": { inputPerM: 10, cachedInputPerM: 1, outputPerM: 30 },
};

/** Fallback price used when a model id is not in the table (fail-expensive). */
const FALLBACK_PRICE: ModelPrice = {
  inputPerM: 15,
  cachedInputPerM: 1.5,
  outputPerM: 75,
};

export function priceFor(modelId: string): ModelPrice {
  return PRICE_TABLE[modelId] ?? FALLBACK_PRICE;
}

/**
 * Convert a token usage object to USD for a given model.
 *
 * Non-cached input tokens are billed at the input rate; cached input tokens at
 * the cached rate. `inputTokens` is treated as the TOTAL input (the AI SDK
 * convention), so non-cached = inputTokens - cachedInputTokens.
 */
export function usageToUsd(modelId: string, usage: TokenUsage): number {
  const price = priceFor(modelId);
  const totalInput = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, totalInput);
  const nonCachedInput = totalInput - cached;
  const output = usage.outputTokens ?? 0;

  const usd =
    (nonCachedInput * price.inputPerM) / 1_000_000 +
    (cached * price.cachedInputPerM) / 1_000_000 +
    (output * price.outputPerM) / 1_000_000;

  // Round to micro-dollars to avoid float drift in accumulated comparisons.
  return Math.round(usd * 1_000_000) / 1_000_000;
}
