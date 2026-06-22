import type { ProviderMetadata } from "ai";

/**
 * Shape of the Vercel AI Gateway entry in `providerMetadata`.
 *
 * The gateway surfaces per-step cost information alongside routing
 * diagnostics. We only care about the cost field here; everything else is
 * documented for reference.
 */
export interface GatewayProviderMetadata {
  gateway: {
    cost?: string;
    marketCost?: string;
    inferenceCost?: string;
    inputInferenceCost?: string;
    outputInferenceCost?: string;
    generationId?: string;
  };
}

function hasGatewayShape(
  metadata: ProviderMetadata | undefined,
): metadata is ProviderMetadata & GatewayProviderMetadata {
  if (!metadata) {
    return false;
  }
  const gateway = (metadata as Record<string, unknown>).gateway;
  return typeof gateway === "object" && gateway !== null;
}

/**
 * Extract the gateway-reported cost for a single step.
 * Returns `undefined` when the step did not go through the gateway or the
 * gateway did not attach a cost (e.g. direct provider call).
 */
export function extractGatewayCost(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  if (!hasGatewayShape(providerMetadata)) {
    return undefined;
  }
  const rawCost = providerMetadata.gateway.cost;
  if (typeof rawCost !== "string") {
    return undefined;
  }
  const cost = Number.parseFloat(rawCost);
  return Number.isFinite(cost) ? cost : undefined;
}

const PROVIDER_TOKENS_PER_SECOND_KEYS = new Set([
  "tokensPerSecond",
  "tokens_per_second",
  "outputTokensPerSecond",
  "output_tokens_per_second",
  "completionTokensPerSecond",
  "completion_tokens_per_second",
  "generatedTokensPerSecond",
  "generated_tokens_per_second",
  "generationTokensPerSecond",
  "generation_tokens_per_second",
]);

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function findProviderTokensPerSecond(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (PROVIDER_TOKENS_PER_SECOND_KEYS.has(key)) {
      const parsed = parseFiniteNumber(childValue);
      if (parsed !== undefined) {
        return parsed;
      }
    }

    const nested = findProviderTokensPerSecond(childValue);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

/**
 * Extract provider-reported generation throughput, when a provider exposes it
 * in metadata. This intentionally does not derive throughput from output token
 * count and wall-clock time; callers can fall back to their own model-step
 * timing when this returns `undefined`.
 */
export function extractProviderTokensPerSecond(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  return findProviderTokensPerSecond(providerMetadata);
}
