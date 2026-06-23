import "server-only";

import {
  type InferenceProfileProvider,
  type InferenceProfileModel,
  inferenceProfileModelSchema,
} from "@/lib/inference/types";
import {
  normalizeAnthropicBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
} from "./model-routing";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Parse an Anthropic-compatible `/v1/models` response body into our stored
 * model shape. Anthropic (and compatible providers such as ZAI) return
 * `{ data: [{ id, display_name, ... }] }`. Unknown/invalid entries are dropped
 * rather than throwing, so one malformed row can't blank the whole list.
 */
export function parseAnthropicModelsResponse(
  body: unknown,
): InferenceProfileModel[] {
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    !Array.isArray((body as { data: unknown }).data)
  ) {
    return [];
  }

  const seen = new Set<string>();
  const models: InferenceProfileModel[] = [];
  for (const entry of (body as { data: unknown[] }).data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    const displayName =
      typeof record.display_name === "string" &&
      record.display_name.trim().length > 0
        ? record.display_name.trim()
        : id;
    const parsed = inferenceProfileModelSchema.safeParse({ id, displayName });
    if (parsed.success) {
      seen.add(id);
      models.push(parsed.data);
    }
  }

  return models;
}

export function parseOpenAICompatibleModelsResponse(
  body: unknown,
): InferenceProfileModel[] {
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    !Array.isArray((body as { data: unknown }).data)
  ) {
    return [];
  }

  const seen = new Set<string>();
  const models: InferenceProfileModel[] = [];
  for (const entry of (body as { data: unknown[] }).data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    const displayName =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim()
        : id;
    const contextWindow =
      typeof record.context_window === "number" &&
      Number.isInteger(record.context_window) &&
      record.context_window > 0
        ? record.context_window
        : undefined;
    const parsed = inferenceProfileModelSchema.safeParse({
      id,
      displayName,
      ...(contextWindow ? { contextWindow } : {}),
    });
    if (parsed.success) {
      seen.add(id);
      models.push(parsed.data);
    }
  }

  return models;
}

/** Build the `/models` listing URL from a provider base or request endpoint. */
function modelsUrl(
  provider: InferenceProfileProvider,
  baseUrl: string | null,
): string {
  const root = modelsBaseUrl(provider, baseUrl).replace(/\/+$/, "");
  return `${root}/models`;
}

function modelsBaseUrl(
  provider: InferenceProfileProvider,
  baseUrl: string | null,
): string {
  if (provider === "anthropic") {
    return normalizeAnthropicBaseUrl(baseUrl) ?? DEFAULT_ANTHROPIC_BASE_URL;
  }

  return normalizeOpenAICompatibleBaseUrl(baseUrl);
}

function anthropicAuthHeaders(baseUrl: string | null, apiKey: string) {
  return {
    "anthropic-version": ANTHROPIC_VERSION,
    ...(usesFireworksBearerAuth(baseUrl)
      ? { Authorization: `Bearer ${apiKey}` }
      : { "x-api-key": apiKey }),
  };
}

function openAICompatibleAuthHeaders(baseUrl: string, apiKey: string) {
  return {
    Authorization: usesBasetenApiKeyAuth(baseUrl)
      ? `Api-Key ${apiKey}`
      : `Bearer ${apiKey}`,
  };
}

function usesBasetenApiKeyAuth(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "inference.baseten.co";
  } catch {
    return false;
  }
}

function usesFireworksBearerAuth(baseUrl: string | null): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    return new URL(baseUrl).hostname === "api.fireworks.ai";
  } catch {
    return false;
  }
}

/**
 * Fetch the model list an inference profile's endpoint actually serves.
 * Best-effort: returns `[]` on any network/HTTP/parse failure so callers can
 * fall back to the legacy catalog-clone behavior without surfacing an error.
 */
export async function fetchInferenceProfileModels(params: {
  provider?: InferenceProfileProvider;
  baseUrl: string | null;
  apiKey: string;
}): Promise<InferenceProfileModel[]> {
  const { apiKey, baseUrl, provider = "anthropic" } = params;
  if (provider !== "anthropic" && !baseUrl) {
    return [];
  }

  try {
    const url = modelsUrl(provider, baseUrl);
    const response = await fetch(url, {
      method: "GET",
      headers:
        provider === "anthropic"
          ? anthropicAuthHeaders(url, apiKey)
          : openAICompatibleAuthHeaders(baseUrl ?? "", apiKey),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as unknown;
    return provider === "anthropic"
      ? parseAnthropicModelsResponse(body)
      : parseOpenAICompatibleModelsResponse(body);
  } catch {
    return [];
  }
}
