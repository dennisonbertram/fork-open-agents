import type { AvailableModel } from "@/lib/models";
import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";

/**
 * Distinguishes "the language-model fetch threw" (recoverable — retry or
 * check the gateway) from "the fetch succeeded but returned zero models"
 * (a configuration state — no gateway models, no inference profiles).
 *
 * `errorKind: "fetch_failed"` is the only error kind this ticket introduces;
 * a successful-but-empty fetch reports `errorKind: null`.
 */
export type ModelsErrorKind = "fetch_failed";

export interface InitialModelsResult {
  models: AvailableModel[];
  errorKind: ModelsErrorKind | null;
}

export type ChatSurface = "desktop" | "mobile";

export interface GetInitialModelsContext {
  sessionId: string;
  chatId: string;
  surface: ChatSurface;
}

function logModelsFetchFailed(context: GetInitialModelsContext): void {
  console.warn(
    "[chat-model-availability] models-fetch-failed",
    JSON.stringify({
      service: "chat-model-availability",
      event: "models-fetch-failed",
      sessionId: context.sessionId,
      chatId: context.chatId,
      errorKind: "fetch_failed",
      surface: context.surface,
    }),
  );
}

function logModelsEmpty(context: GetInitialModelsContext): void {
  console.info(
    "[chat-model-availability] models-empty",
    JSON.stringify({
      service: "chat-model-availability",
      event: "models-empty",
      sessionId: context.sessionId,
      chatId: context.chatId,
      surface: context.surface,
    }),
  );
}

/**
 * Wraps `fetchAvailableLanguageModelsWithContext()` in a typed result so
 * chat pages can render a distinct banner for "the fetch threw" versus
 * "the fetch succeeded but returned no models" instead of collapsing both
 * into an empty array.
 */
export async function getInitialModels(
  context: GetInitialModelsContext,
): Promise<InitialModelsResult> {
  let models: AvailableModel[];
  try {
    models = await fetchAvailableLanguageModelsWithContext();
  } catch {
    logModelsFetchFailed(context);
    return { models: [], errorKind: "fetch_failed" };
  }

  if (models.length === 0) {
    logModelsEmpty(context);
  }

  return { models, errorKind: null };
}
