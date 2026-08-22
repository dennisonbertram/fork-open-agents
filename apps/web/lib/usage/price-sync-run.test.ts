import { describe, expect, test } from "bun:test";
import type { ModelPriceSyncAction } from "./price-sync";
import { runModelPriceSync } from "./price-sync-run";

// Illustrative fixture rates, not any vendor's real prices.
const COST = { input: 3, output: 15, cache_read: 0.3 };

function deps(overrides: {
  catalogue?: Array<{ id: string; cost?: typeof COST }>;
  current?: Array<{ id: string; modelId: string; cost: typeof COST }>;
  captured?: { actions?: ModelPriceSyncAction[] };
}) {
  const captured = overrides.captured ?? {};
  return {
    fetchCatalogue: async () => overrides.catalogue ?? [],
    listCurrentPrices: async () => overrides.current ?? [],
    applyActions: async (actions: ModelPriceSyncAction[]) => {
      captured.actions = actions;
      return {
        inserted: actions.filter((a) => a.kind === "insert").length,
        superseded: actions.filter((a) => a.kind === "supersede").length,
        unchanged: actions.filter((a) => a.kind === "unchanged").length,
      };
    },
  };
}

describe("runModelPriceSync", () => {
  test("inserts prices for models the book has never seen", async () => {
    const summary = await runModelPriceSync(
      deps({ catalogue: [{ id: "anthropic/model-a", cost: COST }] }),
    );

    expect(summary.inserted).toBe(1);
    expect(summary.superseded).toBe(0);
    expect(summary.catalogueSize).toBe(1);
  });

  test("reports unchanged rather than rewriting an identical price", async () => {
    const summary = await runModelPriceSync(
      deps({
        catalogue: [{ id: "anthropic/model-a", cost: COST }],
        current: [{ id: "price_1", modelId: "anthropic/model-a", cost: COST }],
      }),
    );

    expect(summary.unchanged).toBe(1);
    expect(summary.inserted).toBe(0);
    expect(summary.superseded).toBe(0);
  });

  test("supersedes when the published rate has moved", async () => {
    const summary = await runModelPriceSync(
      deps({
        catalogue: [{ id: "anthropic/model-a", cost: { ...COST, output: 18 } }],
        current: [{ id: "price_1", modelId: "anthropic/model-a", cost: COST }],
      }),
    );

    expect(summary.superseded).toBe(1);
    expect(summary.inserted).toBe(0);
  });

  test("counts catalogue entries with no usable rate instead of writing them", async () => {
    // A sync that writes nothing is ambiguous unless the summary distinguishes
    // "already current" from "the catalogue published no rates".
    const summary = await runModelPriceSync(
      deps({
        catalogue: [
          { id: "anthropic/model-a", cost: COST },
          { id: "anthropic/no-price" },
          { id: "anthropic/also-no-price" },
        ],
      }),
    );

    expect(summary.catalogueSize).toBe(3);
    expect(summary.unpricedCatalogueEntries).toBe(2);
    expect(summary.inserted).toBe(1);
  });

  test("never invents a rate for an unpriced catalogue entry", async () => {
    const captured: { actions?: ModelPriceSyncAction[] } = {};
    await runModelPriceSync(
      deps({ catalogue: [{ id: "anthropic/no-price" }], captured }),
    );

    expect(captured.actions).toEqual([]);
  });

  test("an empty catalogue writes nothing at all", async () => {
    const summary = await runModelPriceSync(deps({ catalogue: [] }));

    expect(summary).toMatchObject({
      catalogueSize: 0,
      inserted: 0,
      superseded: 0,
      unchanged: 0,
    });
  });
});
