import type { AvailableModelCost } from "@/lib/models";
import {
  type ModelPriceRow,
  type ModelPriceSyncAction,
  planModelPriceSync,
} from "./price-sync";

export type PriceSyncCatalogueEntry = { id: string; cost?: AvailableModelCost };

export type PriceSyncSummary = {
  /** Models the catalogue returned, before any filtering. */
  catalogueSize: number;
  /** Models the catalogue publishes no usable rate for; these are skipped. */
  unpricedCatalogueEntries: number;
  inserted: number;
  superseded: number;
  unchanged: number;
};

export type PriceSyncDeps = {
  fetchCatalogue: () => Promise<PriceSyncCatalogueEntry[]>;
  listCurrentPrices: () => Promise<ModelPriceRow[]>;
  applyActions: (actions: ModelPriceSyncAction[]) => Promise<{
    inserted: number;
    superseded: number;
    unchanged: number;
  }>;
};

/**
 * Refresh the model price book from the published catalogue.
 *
 * Dependencies are injected rather than imported so the orchestration can be
 * tested without a database or a network call — the part worth testing here is
 * the sequencing and the reporting, not the gateway client.
 *
 * The summary deliberately reports `catalogueSize` and
 * `unpricedCatalogueEntries` alongside the write counts. A sync that inserted
 * nothing is ambiguous on its own: it means either "everything was already
 * current" or "the catalogue came back with no usable rates", and those need
 * very different responses from whoever is reading the log.
 */
export async function runModelPriceSync(
  deps: PriceSyncDeps,
): Promise<PriceSyncSummary> {
  const catalogue = await deps.fetchCatalogue();
  const current = await deps.listCurrentPrices();
  const actions = planModelPriceSync(current, catalogue);

  // planModelPriceSync emits no action at all for an entry it cannot price, so
  // the difference between the catalogue and the plan is exactly the set of
  // models with no usable published rate.
  const unpricedCatalogueEntries = catalogue.length - actions.length;

  const applied = await deps.applyActions(actions);

  return {
    catalogueSize: catalogue.length,
    unpricedCatalogueEntries,
    ...applied,
  };
}
