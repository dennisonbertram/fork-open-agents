import { describe, expect, test } from "bun:test";
import type { AvailableModelCost } from "@/lib/models";
import { priceUsage, USAGE_COST_SCALE } from "./pricing";

// Rates below are illustrative fixtures, not any vendor's real prices. They are
// chosen so the expected totals are exact in decimal and hand-checkable.
const COST: AvailableModelCost = {
  input: 3, // $3.00 per 1M input tokens
  output: 15, // $15.00 per 1M output tokens
  cache_read: 0.3, // $0.30 per 1M cached-read tokens
};

const TIERED: AvailableModelCost = {
  ...COST,
  context_over_200k: { input: 6, output: 22.5, cache_read: 0.6 },
};

describe("priceUsage", () => {
  test("prices uncached input, cached input and output separately", () => {
    // 1M uncached in @ $3 + 1M cached @ $0.30 + 1M out @ $15 = $18.30
    const result = priceUsage(
      {
        inputTokens: 2_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      COST,
    );

    expect(result.pricingStatus).toBe("priced");
    expect(result.costUsd).toBe("18.300000000");
  });

  test("reports no_price when the model has no published cost", () => {
    const result = priceUsage(
      { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
      undefined,
    );

    expect(result.pricingStatus).toBe("no_price");
    expect(result.costUsd).toBeNull();
  });

  test("reports no_price when a published cost is missing a required rate", () => {
    const result = priceUsage(
      { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
      { input: 3 } as AvailableModelCost,
    );

    expect(result.pricingStatus).toBe("no_price");
    expect(result.costUsd).toBeNull();
  });

  test("applies the long-context tier above 200k input tokens", () => {
    // 300k input, none cached, at the over-200k rate of $6/1M = $1.80.
    const result = priceUsage(
      { inputTokens: 300_000, cachedInputTokens: 0, outputTokens: 0 },
      TIERED,
    );

    expect(result.costUsd).toBe("1.800000000");
  });

  test("stays on the standard tier at or below 200k input tokens", () => {
    // 200k input at the standard $3/1M = $0.60. The boundary is exclusive.
    const result = priceUsage(
      { inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 0 },
      TIERED,
    );

    expect(result.costUsd).toBe("0.600000000");
  });

  test("never produces a negative cost when cached exceeds reported input", () => {
    // Providers have reported cachedInputTokens > inputTokens. Treated as
    // fully cached rather than allowed to subtract into a negative charge.
    const result = priceUsage(
      { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 },
      COST,
    );

    expect(Number(result.costUsd)).toBeGreaterThanOrEqual(0);
  });

  test("prices a zero-token event as exactly zero, not as unpriced", () => {
    const result = priceUsage(
      { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      COST,
    );

    expect(result.pricingStatus).toBe("priced");
    expect(Number(result.costUsd)).toBe(0);
  });

  test("emits a fixed-scale decimal string that postgres numeric accepts", () => {
    const result = priceUsage(
      { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 },
      COST,
    );

    // 1 token at $3/1M = $0.000003 — small enough that a lossy format would
    // round it away entirely.
    expect(result.costUsd).toBe("0.000003000");
    expect(result.costUsd?.split(".")[1]).toHaveLength(USAGE_COST_SCALE);
  });
});
