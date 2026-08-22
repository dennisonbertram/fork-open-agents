import { isAuthorizedCronRequest } from "@/app/api/_lib/cron-auth";
import { getBackgroundAgentsCronSecret } from "@/lib/background-agents/config";
import {
  applyModelPriceSync,
  clearModelPriceCache,
  listCurrentModelPrices,
} from "@/lib/db/model-prices";
import { fetchAvailableLanguageModels } from "@/lib/models-with-context";
import { runModelPriceSync } from "@/lib/usage/price-sync-run";

/**
 * Refresh the model price book from the Vercel AI Gateway catalogue.
 *
 * Without this running, `model_prices` stays empty and every usage event is
 * written with `pricing_status = 'unknown_model'` and a NULL cost — the
 * instrumentation is installed but produces no number. This is the job that
 * turns it on.
 *
 * Reuses `CRON_SECRET`, the same secret the existing crons authenticate with,
 * so shipping this needs no new environment variable in any environment. A new
 * variable is the usual way a job like this works in dev and silently 401s in
 * production.
 */
async function handleCron(req: Request): Promise<Response> {
  const secret = getBackgroundAgentsCronSecret();
  if (!secret) {
    return Response.json(
      {
        error: "CRON_SECRET is not configured",
        errorKind: "internal_error",
      },
      { status: 500 },
    );
  }

  if (!isAuthorizedCronRequest(req, secret)) {
    return Response.json(
      { error: "Unauthorized", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const summary = await runModelPriceSync({
      fetchCatalogue: async () => await fetchAvailableLanguageModels(),
      listCurrentPrices: listCurrentModelPrices,
      applyActions: applyModelPriceSync,
    });

    // Prices are memoised for five minutes on the per-turn lookup path, so a
    // sync that changed nothing would otherwise take up to that long to be
    // visible to the very next turn.
    clearModelPriceCache();

    console.log(
      JSON.stringify({
        service: "usage",
        event: "model-price-sync.completed",
        level: "info",
        requestId,
        ...summary,
      }),
    );

    return Response.json({ requestId, ...summary });
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "usage",
        event: "model-price-sync.failed",
        level: "error",
        requestId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );

    return Response.json(
      {
        error: "Model price sync failed",
        errorKind: "internal_error",
        requestId,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  return await handleCron(req);
}

export async function POST(req: Request): Promise<Response> {
  return await handleCron(req);
}
