import { isAuthorizedCronRequest } from "@/app/api/_lib/cron-auth";
import { getBackgroundAgentsCronSecret } from "@/lib/background-agents/config";
import {
  applyModelPriceSync,
  clearModelPriceCache,
  listCurrentModelPrices,
} from "@/lib/db/model-prices";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";
import { runModelPriceSync } from "@/lib/usage/price-sync-run";
import { sweepStaleSandboxSpans } from "@/lib/usage/sandbox-meter";

/**
 * Refresh the model price book from the published model catalogue.
 *
 * Note which catalogue: `fetchAvailableLanguageModels` returns
 * `GatewayAvailableModel`s, which carry NO `cost` field. Rates are attached
 * only by `fetchAvailableLanguageModelsWithContext`, from models.dev metadata.
 * Calling the wrong one leaves every entry unpriced, `model_prices` empty and
 * every usage event stamped `unknown_model` — instrumentation that runs daily
 * and records nothing.
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
      fetchCatalogue: async () =>
        await fetchAvailableLanguageModelsWithContext(),
      listCurrentPrices: listCurrentModelPrices,
      applyActions: applyModelPriceSync,
    });

    // Prices are memoised for five minutes on the per-turn lookup path, so a
    // sync that changed nothing would otherwise take up to that long to be
    // visible to the very next turn.
    clearModelPriceCache();

    // Same cadence, different job: close billing spans for sandboxes the
    // provider reclaimed at their hard timeout, which never ran stop() and so
    // never closed themselves. Cheap, and it keeps "open spans" meaning
    // "actually running" for anything that reads them.
    const swept = await sweepStaleSandboxSpans();

    console.log(
      JSON.stringify({
        service: "usage",
        event: "model-price-sync.completed",
        level: "info",
        requestId,
        ...summary,
      }),
    );

    return Response.json({
      requestId,
      ...summary,
      staleSpansClosed: swept.closed,
    });
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
