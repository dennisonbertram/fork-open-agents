import { describe, expect, test } from "bun:test";
import {
  aggregateUsageByModel,
  estimateUsageCost,
  getCostEstimateDetail,
  mergeUsageDays,
  sumUsageRows,
} from "./summary";

const rows = [
  {
    date: "2026-06-01",
    source: "web" as const,
    agentType: "main" as const,
    provider: "openai",
    modelId: "openai/gpt-5.4",
    inputTokens: 1000,
    cachedInputTokens: 250,
    outputTokens: 500,
    messageCount: 2,
    toolCallCount: 3,
  },
  {
    date: "2026-06-01",
    source: "web" as const,
    agentType: "subagent" as const,
    provider: "openai",
    modelId: "openai/gpt-5.4",
    inputTokens: 2000,
    cachedInputTokens: 500,
    outputTokens: 1000,
    messageCount: 4,
    toolCallCount: 5,
  },
  {
    date: "2026-06-02",
    source: "web" as const,
    agentType: "main" as const,
    provider: null,
    modelId: null,
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 20,
    messageCount: 1,
    toolCallCount: 0,
  },
];

describe("usage summary helpers", () => {
  test("sums rows including cached input tokens", () => {
    expect(sumUsageRows(rows)).toEqual({
      inputTokens: 3010,
      cachedInputTokens: 750,
      outputTokens: 1520,
      messageCount: 7,
      toolCallCount: 8,
    });
  });

  test("merges daily rows without dropping cached input tokens", () => {
    expect(mergeUsageDays(rows)[0]).toEqual({
      date: "2026-06-01",
      inputTokens: 3000,
      cachedInputTokens: 750,
      outputTokens: 1500,
      messageCount: 6,
      toolCallCount: 8,
    });
  });

  test("aggregates model usage and estimates cost with a pricing caveat", () => {
    const modelUsage = aggregateUsageByModel(rows);
    const costEstimate = estimateUsageCost(modelUsage, [
      {
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        cost: {
          input: 2,
          cache_read: 0.5,
          output: 8,
        },
      },
    ]);

    expect(modelUsage).toEqual([
      {
        modelId: "openai/gpt-5.4",
        provider: "openai",
        inputTokens: 3000,
        cachedInputTokens: 750,
        outputTokens: 1500,
        messageCount: 6,
        toolCallCount: 8,
      },
    ]);
    expect(costEstimate?.pricedTokens).toBe(4500);
    expect(costEstimate?.totalTokens).toBe(4500);
    expect(getCostEstimateDetail(costEstimate, false)).toBe(
      "Estimated from models.dev pricing",
    );
  });
});
