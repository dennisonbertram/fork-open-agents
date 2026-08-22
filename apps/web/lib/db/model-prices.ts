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

export function clearModelPriceCache(): void {
  currentPriceCache.clear();
}

export async function getCurrentModelPrice(
  modelId: string,
): Promise<CurrentModelPrice | null> {
  const cached = currentPriceCache.get(modelId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [row] = await db
    .select({ id: modelPrices.id, cost: modelPrices.cost })
    .from(modelPrices)
    .where(
      and(eq(modelPrices.modelId, modelId), isNull(modelPrices.effectiveTo)),
    )
    .orderBy(desc(modelPrices.effectiveFrom))
    .limit(1);

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
        source: "vercel-ai-gateway",
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
