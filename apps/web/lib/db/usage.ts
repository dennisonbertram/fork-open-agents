import { isToolUIPart, type LanguageModel, type UIMessage } from "ai";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UsageDateRange } from "@/lib/usage/date-range";
import { priceUsage, type UsagePricingStatus } from "@/lib/usage/pricing";
import { db } from "./client";
import { getCurrentModelPrice } from "./model-prices";
import { usageEvents } from "./schema";

export type UsageSource = "web" | "background-agent";
export type UsageAgentType = "main" | "subagent";

export async function recordUsage(
  userId: string,
  data: {
    source: UsageSource;
    agentType?: UsageAgentType;
    model: LanguageModel | string;
    inferenceRoute?: "gateway" | "user" | null;
    inferenceProfileId?: string | null;
    messages?: UIMessage[];
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    };
    toolCallCount?: number;
  },
) {
  const inferredToolCallCount =
    data.messages?.flatMap((m) => m.parts).filter(isToolUIPart).length ?? 0;
  const toolCallCount = data.toolCallCount ?? inferredToolCallCount;

  const provider =
    typeof data.model === "string"
      ? data.model.split("/")[0]
      : data.model.provider;
  const modelId =
    typeof data.model === "string" ? data.model : data.model.modelId;

  const priced = await priceUsageForModel(modelId, data.usage);

  await db.insert(usageEvents).values({
    id: nanoid(),
    userId,
    source: data.source,
    agentType: data.agentType ?? "main",
    provider: provider ?? null,
    modelId: modelId ?? null,
    inferenceRoute: data.inferenceRoute ?? null,
    inferenceProfileId: data.inferenceProfileId ?? null,
    inputTokens: data.usage.inputTokens,
    cachedInputTokens: data.usage.cachedInputTokens,
    outputTokens: data.usage.outputTokens,
    toolCallCount,
    costUsd: priced.costUsd,
    pricingStatus: priced.pricingStatus,
    modelPriceId: priced.modelPriceId,
  });
}

/**
 * Value a turn's tokens at the price that is current right now.
 *
 * Stamped at write time, never computed on read. Prices change; a rollup of
 * last month must not silently restate itself when a vendor reprices tomorrow,
 * so the number this returns is frozen onto the row along with the id of the
 * price row that produced it.
 *
 * Pricing is strictly best-effort. This runs at the end of every assistant
 * turn, and a price lookup that fails — a cold database, a model the catalogue
 * has never heard of — must cost the user their usage record, not their turn.
 * Any failure degrades to an unpriced row, which the `pricing_status` column
 * then makes visible as a coverage gap rather than hiding as a zero.
 */
async function priceUsageForModel(
  modelId: string | undefined,
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
): Promise<{
  costUsd: string | null;
  pricingStatus: UsagePricingStatus;
  modelPriceId: string | null;
}> {
  if (!modelId) {
    return {
      costUsd: null,
      pricingStatus: "unknown_model",
      modelPriceId: null,
    };
  }

  try {
    const price = await getCurrentModelPrice(modelId);
    if (!price) {
      return {
        costUsd: null,
        pricingStatus: "unknown_model",
        modelPriceId: null,
      };
    }

    const { costUsd, pricingStatus } = priceUsage(usage, price.cost);
    return {
      costUsd,
      pricingStatus,
      modelPriceId: pricingStatus === "priced" ? price.id : null,
    };
  } catch {
    return { costUsd: null, pricingStatus: "no_price", modelPriceId: null };
  }
}

export interface DailyUsage {
  date: string;
  source: UsageSource;
  agentType: UsageAgentType;
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export interface InferenceProfileUsageSummaryRow {
  inferenceProfileId: string;
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export interface UsageHistoryOptions {
  days?: number;
  range?: UsageDateRange;
  allTime?: boolean;
}

function buildUsageHistoryWhereClause(
  userId: string,
  options?: UsageHistoryOptions,
) {
  if (options?.range) {
    return sql`${usageEvents.userId} = ${userId} and date(${usageEvents.createdAt}) >= ${options.range.from} and date(${usageEvents.createdAt}) <= ${options.range.to}`;
  }

  if (options?.allTime) {
    return sql`${usageEvents.userId} = ${userId}`;
  }

  const days = options?.days ?? 280;
  const since = new Date();
  since.setDate(since.getDate() - days);

  return sql`${usageEvents.userId} = ${userId} and ${usageEvents.createdAt} >= ${since.toISOString()}`;
}

export async function getUsageHistory(
  userId: string,
  options?: UsageHistoryOptions,
): Promise<DailyUsage[]> {
  const rows = await db
    .select({
      date: sql<string>`date(${usageEvents.createdAt})`,
      source: usageEvents.source,
      agentType: usageEvents.agentType,
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::double precision`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::double precision`,
      messageCount: sql<number>`coalesce(sum(case when ${usageEvents.agentType} = 'main' then 1 else 0 end), 0)::double precision`,
      toolCallCount: sql<number>`coalesce(sum(${usageEvents.toolCallCount}), 0)::double precision`,
    })
    .from(usageEvents)
    .where(buildUsageHistoryWhereClause(userId, options))
    .groupBy(
      sql`date(${usageEvents.createdAt})`,
      usageEvents.source,
      usageEvents.agentType,
      usageEvents.provider,
      usageEvents.modelId,
    )
    .orderBy(sql`date(${usageEvents.createdAt})`);

  return rows;
}

export async function getInferenceProfileUsageSummary(
  userId: string,
): Promise<InferenceProfileUsageSummaryRow[]> {
  const rows = await db
    .select({
      inferenceProfileId: usageEvents.inferenceProfileId,
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::double precision`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::double precision`,
      messageCount: sql<number>`coalesce(sum(case when ${usageEvents.agentType} = 'main' then 1 else 0 end), 0)::double precision`,
      toolCallCount: sql<number>`coalesce(sum(${usageEvents.toolCallCount}), 0)::double precision`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        isNotNull(usageEvents.inferenceProfileId),
      ),
    )
    .groupBy(
      usageEvents.inferenceProfileId,
      usageEvents.provider,
      usageEvents.modelId,
    );

  return rows.flatMap((row) =>
    row.inferenceProfileId
      ? [
          {
            ...row,
            inferenceProfileId: row.inferenceProfileId,
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Cost rollups
//
// The multi-tenant question these answer is "what did each tenant spend, on
// which model, and who paid for it" — which is three different questions that
// have to be answered by the same row set or the numbers stop reconciling.
//
// Every rollup carries its own coverage (`pricedEventCount` against
// `eventCount`). A cost total with no coverage figure beside it is not a
// number anyone should act on: if half the events had no published price, the
// total is half a total, and nothing in the value itself says so.
//
// Sums stay in SQL as `numeric` and come back as strings. Casting money to
// double precision to make it a convenient JS number is how totals quietly
// drift, and these totals are meant to be reconciled against a real invoice.
// ---------------------------------------------------------------------------

export interface ModelCostRollupRow {
  userId: string;
  provider: string | null;
  modelId: string | null;
  /** "gateway" is platform spend; "user" is a caller's own key. */
  inferenceRoute: "gateway" | "user" | null;
  eventCount: number;
  pricedEventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Exact decimal string. Sum of the costs stamped on each event. */
  costUsd: string;
}

export interface CostRollupOptions {
  /** Omit to roll up every tenant — the operator view. */
  userId?: string;
  range?: UsageDateRange;
  days?: number;
}

function buildCostRollupWhereClause(options?: CostRollupOptions) {
  const clauses = [sql`true`];

  if (options?.userId) {
    clauses.push(sql`${usageEvents.userId} = ${options.userId}`);
  }

  if (options?.range) {
    clauses.push(
      sql`date(${usageEvents.createdAt}) >= ${options.range.from} and date(${usageEvents.createdAt}) <= ${options.range.to}`,
    );
  } else {
    const days = options?.days ?? 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    clauses.push(sql`${usageEvents.createdAt} >= ${since.toISOString()}`);
  }

  return sql.join(clauses, sql` and `);
}

/**
 * Spend per user per model.
 *
 * Pass `userId` for one tenant's own settings page; omit it for the
 * cross-tenant operator view that answers "who is costing us what".
 */
export async function getModelCostRollup(
  options?: CostRollupOptions,
): Promise<ModelCostRollupRow[]> {
  const rows = await db
    .select({
      userId: usageEvents.userId,
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      inferenceRoute: usageEvents.inferenceRoute,
      eventCount: sql<number>`count(*)::double precision`,
      pricedEventCount: sql<number>`coalesce(sum(case when ${usageEvents.pricingStatus} = 'priced' then 1 else 0 end), 0)::double precision`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::double precision`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::double precision`,
      costUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)::text`,
    })
    .from(usageEvents)
    .where(buildCostRollupWhereClause(options))
    .groupBy(
      usageEvents.userId,
      usageEvents.provider,
      usageEvents.modelId,
      usageEvents.inferenceRoute,
    )
    .orderBy(sql`sum(${usageEvents.costUsd}) desc nulls last`);

  return rows;
}

export interface CostCoverageSummary {
  eventCount: number;
  pricedEventCount: number;
  unknownModelEventCount: number;
  /** 0–1. The share of events the price book could actually value. */
  pricedRatio: number;
  /** Platform spend: gateway-routed events only. */
  platformCostUsd: string;
  /** Value of tokens a caller paid for with their own key. */
  userKeyCostUsd: string;
  /**
   * Priced events whose route was never recorded, so it is not known who paid.
   *
   * Not folded into platform spend. `recordUsage` is called without a route in
   * places (the subagent path in chat-post-finish-impl.ts), and defaulting
   * those to "we paid" would silently bill the platform for a BYO-key user's
   * subagent turns. An unclassified bucket is a visible gap; a wrong total is
   * not.
   */
  unclassifiedCostUsd: string;
}

/**
 * Coverage and split for a window, so a total can be read with the confidence
 * it deserves. Publish this next to any cost figure.
 */
export async function getCostCoverage(
  options?: CostRollupOptions,
): Promise<CostCoverageSummary> {
  const [row] = await db
    .select({
      eventCount: sql<number>`count(*)::double precision`,
      pricedEventCount: sql<number>`coalesce(sum(case when ${usageEvents.pricingStatus} = 'priced' then 1 else 0 end), 0)::double precision`,
      unknownModelEventCount: sql<number>`coalesce(sum(case when ${usageEvents.pricingStatus} = 'unknown_model' then 1 else 0 end), 0)::double precision`,
      platformCostUsd: sql<string>`coalesce(sum(case when ${usageEvents.inferenceRoute} = 'gateway' then ${usageEvents.costUsd} else 0 end), 0)::text`,
      userKeyCostUsd: sql<string>`coalesce(sum(case when ${usageEvents.inferenceRoute} = 'user' then ${usageEvents.costUsd} else 0 end), 0)::text`,
      unclassifiedCostUsd: sql<string>`coalesce(sum(case when ${usageEvents.inferenceRoute} is null then ${usageEvents.costUsd} else 0 end), 0)::text`,
    })
    .from(usageEvents)
    .where(buildCostRollupWhereClause(options));

  const eventCount = row?.eventCount ?? 0;
  const pricedEventCount = row?.pricedEventCount ?? 0;

  return {
    eventCount,
    pricedEventCount,
    unknownModelEventCount: row?.unknownModelEventCount ?? 0,
    pricedRatio: eventCount === 0 ? 0 : pricedEventCount / eventCount,
    platformCostUsd: row?.platformCostUsd ?? "0",
    userKeyCostUsd: row?.userKeyCostUsd ?? "0",
    unclassifiedCostUsd: row?.unclassifiedCostUsd ?? "0",
  };
}
