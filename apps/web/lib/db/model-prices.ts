import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AvailableModelCost } from "@/lib/models";
import type {
  ModelPriceRow,
  ModelPriceSyncAction,
} from "@/lib/usage/price-sync";
import { db } from "./client";
import { modelPrices } from "./schema";

type CurrentModelPrice = { id: string; cost: AvailableModelCost };

// Read on every assistant turn (priceUsage needs the current rate), so the
// hot path is memoised in-process rather than hitting Postgres each time.
// ponytail: module-level cache, single instance only — move to a shared
// cache (Redis) if this ever runs across multiple processes that need to
// agree sooner than the TTL.
const CACHE_TTL_MS = 5 * 60 * 1000;
const currentPriceCache = new Map<
  string,
  { value: CurrentModelPrice | null; expiresAt: number }
>();

/**
 * Circuit breaker for an unreachable price book.
 *
 * Pricing is best-effort and runs on every assistant turn, so a database that
 * is briefly unreachable would otherwise mean one failed connection attempt per
 * turn — a connection storm at exactly the moment the database is least able to
 * absorb one. A short cool-off makes the first failure the only attempt for a
 * while; callers get unpriced rows meanwhile, which `pricing_status` already
 * reports honestly.
 */
const LOOKUP_COOLDOWN_MS = 30 * 1000;
let lookupUnavailableUntil = 0;

export function clearModelPriceCache(): void {
  currentPriceCache.clear();
  lookupUnavailableUntil = 0;
}

export async function getCurrentModelPrice(
  modelId: string,
): Promise<CurrentModelPrice | null> {
  const cached = currentPriceCache.get(modelId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (Date.now() < lookupUnavailableUntil) {
    return null;
  }

  let row: CurrentModelPrice | undefined;
  try {
    [row] = await db
      .select({ id: modelPrices.id, cost: modelPrices.cost })
      .from(modelPrices)
      .where(
        and(eq(modelPrices.modelId, modelId), isNull(modelPrices.effectiveTo)),
      )
      .orderBy(desc(modelPrices.effectiveFrom))
      .limit(1);
  } catch (error) {
    lookupUnavailableUntil = Date.now() + LOOKUP_COOLDOWN_MS;
    console.warn(
      JSON.stringify({
        service: "usage",
        event: "model-price-lookup-unavailable",
        level: "warn",
        cooldownMs: LOOKUP_COOLDOWN_MS,
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    );
    return null;
  }

  const value = row ?? null;
  currentPriceCache.set(modelId, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return value;
}

export async function listCurrentModelPrices(): Promise<ModelPriceRow[]> {
  return await db
    .select({
      id: modelPrices.id,
      modelId: modelPrices.modelId,
      cost: modelPrices.cost,
    })
    .from(modelPrices)
    .where(isNull(modelPrices.effectiveTo));
}

export async function applyModelPriceSync(
  actions: ModelPriceSyncAction[],
): Promise<{ inserted: number; superseded: number; unchanged: number }> {
  let inserted = 0;
  let superseded = 0;
  let unchanged = 0;

  await db.transaction(async (tx) => {
    const now = new Date();
    for (const action of actions) {
      if (action.kind === "unchanged") {
        unchanged++;
        continue;
      }

      if (action.kind === "supersede") {
        await tx
          .update(modelPrices)
          .set({ effectiveTo: now })
          .where(eq(modelPrices.id, action.priceId));
      }

      await tx.insert(modelPrices).values({
        id: nanoid(),
        modelId: action.modelId,
        provider: action.provider,
        cost: action.cost,
        // models.dev is where these rates actually come from: the raw gateway
        // catalogue carries no `cost` field at all. Writing anything else here
        // makes the column lie and leaves an audit unable to tell a published
        // rate from a hand-entered one.
        source: "models-dev",
      });

      if (action.kind === "supersede") {
        superseded++;
      } else {
        inserted++;
      }
    }
  });

  clearModelPriceCache();
  return { inserted, superseded, unchanged };
}
