import { type AvailableModelCost, estimateModelUsageCost } from "@/lib/models";

/**
 * Decimal places kept on a stamped usage cost.
 *
 * Matches `numeric(18, 9)` on `usage_events.cost_usd`. Nine places is not
 * decoration: a single token on a cheap model is worth about 3e-7 USD, so a
 * two-place "money" format would round almost every individual event to zero
 * and a per-user total would be built entirely out of rounding error.
 */
export const USAGE_COST_SCALE = 9;

export type UsagePricingStatus = "priced" | "no_price" | "unknown_model";

export type PricedUsage = {
  /**
   * Fixed-scale decimal string, or null when the event could not be priced.
   * A string rather than a number because this is written straight into a
   * postgres `numeric` column, and going through a JS float on the way would
   * reintroduce exactly the binary dust the column type exists to avoid.
   */
  costUsd: string | null;
  pricingStatus: UsagePricingStatus;
};

export type UsageTokenCounts = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

/**
 * Value a single usage event at a published price.
 *
 * The arithmetic is deliberately delegated to `estimateModelUsageCost`, which
 * already owns the two rules that are easy to get subtly wrong and expensive to
 * have diverge: cached-read tokens are billed at their own rate and deducted
 * from the uncached input they were reported alongside, and models with a
 * `context_over_200k` tier switch rates once an event's input exceeds 200k
 * tokens. A second implementation here would be a second place for those rules
 * to drift.
 *
 * `cost` is whatever the price book had for this model at write time. Passing
 * `undefined` is the normal case for a model we have no published rate for, and
 * it yields `no_price` rather than a zero — a zero would quietly understate a
 * tenant's spend, which is worse than an honest gap.
 */
export function priceUsage(
  usage: UsageTokenCounts,
  cost: AvailableModelCost | undefined,
): PricedUsage {
  const amount = estimateModelUsageCost(usage, cost);

  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { costUsd: null, pricingStatus: "no_price" };
  }

  return {
    costUsd: Math.max(0, amount).toFixed(USAGE_COST_SCALE),
    pricingStatus: "priced",
  };
}
