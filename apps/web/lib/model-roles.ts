import type { AvailableModelCost } from "@/lib/models";

export const MODEL_ROLE_HINTS: Record<string, string> = {};

export function deriveCostTier(
  cost: Pick<AvailableModelCost, "input" | "output"> | undefined,
): "$" | "$$" | "$$$" | undefined {
  // stub — not yet implemented
  return undefined;
}

export function deriveRoleHint(modelId: string): string | undefined {
  // stub — not yet implemented
  return undefined;
}
