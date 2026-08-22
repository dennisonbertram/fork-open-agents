/**
 * Vercel Sandbox pricing — iad1 region (the default region for a sandbox
 * created without an explicit `region`).
 *
 * Source: https://vercel.com/docs/sandbox/pricing (page last_updated 2026-08-04)
 *
 * These are the published rates from that page, not derived or estimated.
 * DO NOT edit the numbers below without updating the source URL/date comment
 * above to match whatever you re-read from Vercel's pricing page.
 *
 * Active CPU ($0.128 / CPU-hour) is deliberately NOT modeled here. A sandbox
 * has no way to observe its own active-vs-idle CPU time from the inside, so
 * any number this module produced for it would be invented, not measured.
 * The cost this module returns is a memory + creation-fee floor, not a full
 * bill — treat `estimatedCostUsd` as an underestimate of the real Vercel
 * invoice.
 */
const SANDBOX_PRICING = {
  sourceUrl: "https://vercel.com/docs/sandbox/pricing",
  sourceLastUpdated: "2026-08-04",
  region: "iad1",
  memoryUsdPerGbHour: 0.0212,
  creationUsdPerMillionCreations: 0.6,
} as const;

/**
 * Vercel bills provisioned memory in whole-minute increments; a span shorter
 * than one minute is still billed as one minute.
 */
const MINIMUM_BILLED_WALL_CLOCK_MS = 60_000;

/** Decimal places on both `numeric` columns this feeds (see schema.ts). */
export const SANDBOX_COST_SCALE = 9;

function clampWallClockMs(wallClockMs: number): number {
  if (
    !Number.isFinite(wallClockMs) ||
    wallClockMs < MINIMUM_BILLED_WALL_CLOCK_MS
  ) {
    return MINIMUM_BILLED_WALL_CLOCK_MS;
  }
  return wallClockMs;
}

function toFixedScale(value: number): string {
  // Avoid emitting "-0.000000000" for a value that only rounds to zero from
  // the negative side.
  return (Object.is(value, -0) ? 0 : value).toFixed(SANDBOX_COST_SCALE);
}

/**
 * Estimate what one sandbox billing span cost, from what a sandbox can
 * actually observe about itself: how much memory it was provisioned and how
 * long it lived. Excludes Active CPU — see the module doc comment.
 *
 * Returns fixed-scale decimal strings (never floats) so callers can write
 * them straight into `numeric(18, 9)` columns without a float round-trip.
 */
export function estimateSandboxCost(input: {
  memoryMb: number;
  wallClockMs: number;
}): { memoryGbHours: string; estimatedCostUsd: string } {
  const billedWallClockMs = clampWallClockMs(input.wallClockMs);
  const memoryGbHours =
    (input.memoryMb / 1024) * (billedWallClockMs / 3_600_000);
  const estimatedCostUsd =
    memoryGbHours * SANDBOX_PRICING.memoryUsdPerGbHour +
    SANDBOX_PRICING.creationUsdPerMillionCreations / 1_000_000;

  return {
    memoryGbHours: toFixedScale(memoryGbHours),
    estimatedCostUsd: toFixedScale(estimatedCostUsd),
  };
}
