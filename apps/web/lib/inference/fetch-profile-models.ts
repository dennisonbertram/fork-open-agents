import "server-only";

import {
  type InferenceProfileModel,
  inferenceProfileModelSchema,
} from "@/lib/inference/types";

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

/** Build the `/models` listing URL from a normalized (versioned) base URL. */
function modelsUrl(baseUrl: string | null): string {
  const root = (baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  return `${root}/models`;
}

/**
 * Fetch the model list an inference profile's endpoint actually serves.
 * Best-effort: returns `[]` on any network/HTTP/parse failure so callers can
 * fall back to the legacy catalog-clone behavior without surfacing an error.
 */
export async function fetchInferenceProfileModels(params: {
  baseUrl: string | null;
  apiKey: string;
}): Promise<InferenceProfileModel[]> {
  const { apiKey, baseUrl } = params;

  try {
    const response = await fetch(modelsUrl(baseUrl), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as unknown;
    return parseAnthropicModelsResponse(body);
  } catch {
    return [];
  }
}
