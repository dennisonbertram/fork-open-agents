import type { AvailableModelCost } from "@/lib/models";

export type ModelPriceRow = {
  id: string;
  modelId: string;
  cost: AvailableModelCost;
};

export type ModelPriceSyncAction =
  | {
      kind: "insert";
      modelId: string;
      provider: string;
      cost: AvailableModelCost;
    }
  | {
      kind: "supersede";
      priceId: string;
      modelId: string;
      provider: string;
      cost: AvailableModelCost;
    }
  | { kind: "unchanged"; modelId: string };

export type ModelPriceCatalogueEntry = {
  id: string;
  cost?: AvailableModelCost;
};

function providerOf(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

function hasRate(
  cost: AvailableModelCost | undefined,
): cost is AvailableModelCost {
  return typeof cost?.input === "number" || typeof cost?.output === "number";
}

// Deep, key-order-insensitive equality for the small nested cost shape
// (a flat tier plus an optional context_over_200k tier, numbers only).
// Sorting keys before stringifying is enough here — no arrays, no cycles.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return entries.map(([k, v]) => [k, canonicalize(v)]);
  }
  return value;
}

function costsEqual(a: AvailableModelCost, b: AvailableModelCost): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

export function planModelPriceSync(
  current: ModelPriceRow[],
  catalogue: ModelPriceCatalogueEntry[],
): ModelPriceSyncAction[] {
  const currentByModelId = new Map(current.map((row) => [row.modelId, row]));
  const actions: ModelPriceSyncAction[] = [];

  for (const entry of catalogue) {
    if (!hasRate(entry.cost)) {
      continue;
    }
    const cost = entry.cost;
    const provider = providerOf(entry.id);
    const existing = currentByModelId.get(entry.id);

    if (!existing) {
      actions.push({ kind: "insert", modelId: entry.id, provider, cost });
    } else if (costsEqual(existing.cost, cost)) {
      actions.push({ kind: "unchanged", modelId: entry.id });
    } else {
      actions.push({
        kind: "supersede",
        priceId: existing.id,
        modelId: entry.id,
        provider,
        cost,
      });
    }
  }

  return actions;
}
