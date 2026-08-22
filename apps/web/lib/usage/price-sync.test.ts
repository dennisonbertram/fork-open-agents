import { describe, expect, test } from "bun:test";
import { type ModelPriceRow, planModelPriceSync } from "@/lib/usage/price-sync";

// All rates below are illustrative fixtures for these tests only —
// not real vendor prices.

describe("planModelPriceSync", () => {
  test("inserts a model with no current row", () => {
    const actions = planModelPriceSync(
      [],
      [{ id: "anthropic/claude-opus-4.5", cost: { input: 5, output: 25 } }],
    );

    expect(actions).toEqual([
      {
        kind: "insert",
        modelId: "anthropic/claude-opus-4.5",
        provider: "anthropic",
        cost: { input: 5, output: 25 },
      },
    ]);
  });

  test("uses the whole id as provider when there is no slash", () => {
    const actions = planModelPriceSync(
      [],
      [{ id: "standalone-model", cost: { input: 1, output: 2 } }],
    );

    expect(actions).toEqual([
      {
        kind: "insert",
        modelId: "standalone-model",
        provider: "standalone-model",
        cost: { input: 1, output: 2 },
      },
    ]);
  });

  test("skips a catalogue model with no cost", () => {
    const actions = planModelPriceSync(
      [],
      [{ id: "anthropic/claude-haiku-4.5" }],
    );
    expect(actions).toEqual([]);
  });

  test("skips a catalogue model whose cost has neither input nor output", () => {
    const actions = planModelPriceSync(
      [],
      [{ id: "anthropic/claude-haiku-4.5", cost: { cache_read: 0.1 } }],
    );
    expect(actions).toEqual([]);
  });

  test("marks unchanged when cost is deeply equal, regardless of key order", () => {
    const current: ModelPriceRow[] = [
      {
        id: "price_1",
        modelId: "openai/gpt-5.4",
        cost: { output: 15, input: 3 },
      },
    ];

    const actions = planModelPriceSync(current, [
      { id: "openai/gpt-5.4", cost: { input: 3, output: 15 } },
    ]);

    expect(actions).toEqual([{ kind: "unchanged", modelId: "openai/gpt-5.4" }]);
  });

  test("marks unchanged when a nested context_over_200k tier has same values in different key order", () => {
    const current: ModelPriceRow[] = [
      {
        id: "price_1",
        modelId: "anthropic/claude-opus-4.5",
        cost: {
          input: 5,
          output: 25,
          context_over_200k: { output: 37.5, input: 7.5 },
        },
      },
    ];

    const actions = planModelPriceSync(current, [
      {
        id: "anthropic/claude-opus-4.5",
        cost: {
          input: 5,
          output: 25,
          context_over_200k: { input: 7.5, output: 37.5 },
        },
      },
    ]);

    expect(actions).toEqual([
      { kind: "unchanged", modelId: "anthropic/claude-opus-4.5" },
    ]);
  });

  test("supersedes when the top-level cost differs", () => {
    const current: ModelPriceRow[] = [
      {
        id: "price_1",
        modelId: "openai/gpt-5.4",
        cost: { input: 3, output: 15 },
      },
    ];

    const actions = planModelPriceSync(current, [
      { id: "openai/gpt-5.4", cost: { input: 4, output: 15 } },
    ]);

    expect(actions).toEqual([
      {
        kind: "supersede",
        priceId: "price_1",
        modelId: "openai/gpt-5.4",
        provider: "openai",
        cost: { input: 4, output: 15 },
      },
    ]);
  });

  test("supersedes when only the nested context_over_200k tier changes", () => {
    const current: ModelPriceRow[] = [
      {
        id: "price_1",
        modelId: "anthropic/claude-opus-4.5",
        cost: {
          input: 5,
          output: 25,
          context_over_200k: { input: 7.5, output: 37.5 },
        },
      },
    ];

    const actions = planModelPriceSync(current, [
      {
        id: "anthropic/claude-opus-4.5",
        cost: {
          input: 5,
          output: 25,
          context_over_200k: { input: 9, output: 37.5 },
        },
      },
    ]);

    expect(actions).toEqual([
      {
        kind: "supersede",
        priceId: "price_1",
        modelId: "anthropic/claude-opus-4.5",
        provider: "anthropic",
        cost: {
          input: 5,
          output: 25,
          context_over_200k: { input: 9, output: 37.5 },
        },
      },
    ]);
  });

  test("leaves a current row alone when its model is no longer in the catalogue", () => {
    const current: ModelPriceRow[] = [
      {
        id: "price_1",
        modelId: "retired/old-model",
        cost: { input: 1, output: 2 },
      },
    ];

    const actions = planModelPriceSync(current, [
      { id: "openai/gpt-5.4", cost: { input: 3, output: 15 } },
    ]);

    // No action mentions retired/old-model — its history is left untouched.
    expect(actions).toEqual([
      {
        kind: "insert",
        modelId: "openai/gpt-5.4",
        provider: "openai",
        cost: { input: 3, output: 15 },
      },
    ]);
    expect(
      actions.some((a) => "modelId" in a && a.modelId === "retired/old-model"),
    ).toBe(false);
  });
});
