import { estimateModelUsageCost, type AvailableModel } from "@/lib/models";

export interface DailyUsageRow {
  date: string;
  source: "web";
  agentType: "main" | "subagent";
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export interface MergedUsageDay extends UsageTotals {
  date: string;
}

export interface ModelUsage extends UsageTotals {
  modelId: string;
  provider: string;
}

export interface CostEstimateSummary {
  amount: number;
  pricedTokens: number;
  totalTokens: number;
}

export function sumUsageRows(rows: DailyUsageRow[]): UsageTotals {
  return rows.reduce(
    (acc, d) => ({
      inputTokens: acc.inputTokens + d.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + d.cachedInputTokens,
      outputTokens: acc.outputTokens + d.outputTokens,
      messageCount: acc.messageCount + d.messageCount,
      toolCallCount: acc.toolCallCount + d.toolCallCount,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      messageCount: 0,
      toolCallCount: 0,
    },
  );
}

export function mergeUsageDays(rows: DailyUsageRow[]): MergedUsageDay[] {
  const map = new Map<string, MergedUsageDay>();
  for (const r of rows) {
    const existing = map.get(r.date);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.cachedInputTokens += r.cachedInputTokens;
      existing.outputTokens += r.outputTokens;
      existing.messageCount += r.messageCount;
      existing.toolCallCount += r.toolCallCount;
    } else {
      map.set(r.date, {
        date: r.date,
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
        messageCount: r.messageCount,
        toolCallCount: r.toolCallCount,
      });
    }
  }
  return [...map.values()];
}

export function aggregateUsageByModel(rows: DailyUsageRow[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();
  for (const r of rows) {
    if (!r.modelId) {
      continue;
    }

    const existing = map.get(r.modelId);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.cachedInputTokens += r.cachedInputTokens;
      existing.outputTokens += r.outputTokens;
      existing.messageCount += r.messageCount;
      existing.toolCallCount += r.toolCallCount;
    } else {
      map.set(r.modelId, {
        modelId: r.modelId,
        provider: r.provider ?? "unknown",
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
        messageCount: r.messageCount,
        toolCallCount: r.toolCallCount,
      });
    }
  }
  return [...map.values()].toSorted(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
}

export function displayModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export function formatUsd(amount: number): string {
  if (amount >= 100) {
    return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (amount >= 0.01) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  );
}

export function estimateUsageCost(
  modelUsage: ModelUsage[],
  models: AvailableModel[],
): CostEstimateSummary | undefined {
  let amount = 0;
  let pricedTokens = 0;
  let totalTokens = 0;
  const modelsById = new Map(models.map((model) => [model.id, model]));

  for (const usage of modelUsage) {
    const modelTotalTokens = usage.inputTokens + usage.outputTokens;
    totalTokens += modelTotalTokens;

    const cost = estimateModelUsageCost(
      usage,
      modelsById.get(usage.modelId)?.cost,
    );
    if (cost === undefined) {
      continue;
    }

    amount += cost;
    pricedTokens += modelTotalTokens;
  }

  if (totalTokens <= 0) {
    return undefined;
  }

  return {
    amount,
    pricedTokens,
    totalTokens,
  };
}

export function getCostEstimateDetail(
  costEstimate: CostEstimateSummary | undefined,
  isPricingLoading: boolean,
): string {
  if (isPricingLoading) {
    return "Loading model pricing";
  }

  if (!costEstimate) {
    return "No model usage";
  }

  if (costEstimate.pricedTokens <= 0) {
    return "No pricing available for used models";
  }

  if (costEstimate.pricedTokens >= costEstimate.totalTokens) {
    return "Estimated from models.dev pricing";
  }

  return `Estimated from ${Math.round((costEstimate.pricedTokens / costEstimate.totalTokens) * 100)}% of tokens with known pricing`;
}
