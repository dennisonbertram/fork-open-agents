import {
  createGateway,
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type GatewayModelId,
  type JSONValue,
  type LanguageModel,
} from "ai";
import {
  createAnthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

function supportsAdaptiveAnthropicThinking(modelId: string): boolean {
  // Adaptive thinking is supported for Anthropic 4.6 and later.
  // Extract the version number from the model ID (e.g., "claude-opus-4.8" -> 4.8).
  // The version pattern is after "claude-" and before any "-" that follows.
  // Examples:
  //   - "claude-opus-4.8" -> major=4, minor=8 -> true (8 >= 6)
  //   - "claude-opus-4.5" -> major=4, minor=5 -> false (5 < 6)
  //   - "claude-opus-4" -> major=4, minor=0 -> false (0 < 6)
  //   - "claude-haiku-4.5" -> major=4, minor=5 -> false (5 < 6)

  const versionMatch = modelId.match(/claude-\w+-(\d+)\.?(\d*)/);
  if (!versionMatch || !versionMatch[1]) {
    return false;
  }

  const major = parseInt(versionMatch[1], 10);
  const minorStr = versionMatch[2] ?? "";
  const minor = minorStr ? parseInt(minorStr, 10) : 0;

  // Adaptive thinking requires Claude 4.6 or later
  if (major < 4) {
    return false;
  }

  if (major > 4) {
    return true; // Future Claude 5.0+ models support adaptive thinking
  }

  // For Claude 4.x, check if minor >= 6
  return minor >= 6;
}

// Models with adaptive thinking support use effort control.
// Older models use the legacy extended thinking API with a budget.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (supportsAdaptiveAnthropicThinking(modelId)) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions;
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProviderOptionsRecord(
  options: Record<string, unknown>,
): Record<string, JSONValue> {
  return options as Record<string, JSONValue>;
}

function mergeRecords(
  base: Record<string, JSONValue>,
  override: Record<string, JSONValue>,
): Record<string, JSONValue> {
  const merged: Record<string, JSONValue> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existingValue = merged[key];

    if (isJsonObject(existingValue) && isJsonObject(value)) {
      merged[key] = mergeRecords(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JSONValue>
>;

export function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides || Object.keys(overrides).length === 0) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerOverrides] of Object.entries(overrides)) {
    const providerDefaults = merged[provider];

    if (!providerDefaults) {
      merged[provider] = providerOverrides;
      continue;
    }

    merged[provider] = mergeRecords(providerDefaults, providerOverrides);
  }

  return merged;
}

export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
}

export interface DirectAnthropicConfig {
  provider: "anthropic";
  modelId: string;
  apiKey: string;
  baseURL?: string;
}

export interface GatewayOptions {
  config?: GatewayConfig;
  directAnthropic?: DirectAnthropicConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
  appName?: string;
  appUrl?: string;
}

export type { GatewayModelId, LanguageModel, JSONValue };

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

const ANTHROPIC_DIRECT_MODEL_IDS: Record<string, string> = {
  "anthropic/claude-haiku-4.5": "claude-haiku-4-5",
  "anthropic/claude-opus-4": "claude-opus-4-0",
  "anthropic/claude-opus-4.1": "claude-opus-4-1",
  "anthropic/claude-opus-4.5": "claude-opus-4-5",
  "anthropic/claude-opus-4.6": "claude-opus-4-6",
  "anthropic/claude-opus-4.7": "claude-opus-4-7",
  "anthropic/claude-opus-4.8": "claude-opus-4-8",
  "anthropic/claude-sonnet-4": "claude-sonnet-4-0",
  "anthropic/claude-sonnet-4.5": "claude-sonnet-4-5",
  "anthropic/claude-sonnet-4.6": "claude-sonnet-4-6",
};

export function toAnthropicDirectModelId(modelId: string): string | null {
  if (!modelId.startsWith("anthropic/")) {
    return null;
  }

  const mappedModelId = ANTHROPIC_DIRECT_MODEL_IDS[modelId];
  if (mappedModelId) {
    return mappedModelId;
  }

  return modelId.slice("anthropic/".length).replaceAll(".", "-");
}

export function directAnthropicModel(
  config: DirectAnthropicConfig,
  options: Pick<GatewayOptions, "appName" | "appUrl"> = {},
): WrappableLanguageModel {
  const attributionHeaders = {
    "http-referer": options.appUrl ?? "https://open-agents.dev",
    "x-title": options.appName ?? "Open Agents",
  };
  const anthropicProvider = createAnthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    headers: attributionHeaders,
  });

  return anthropicProvider(
    config.modelId as Parameters<typeof anthropicProvider>[0],
  ) as WrappableLanguageModel;
}

export function getProviderOptionsForModel(
  modelId: string,
  providerOptionsOverrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic defaults
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = toProviderOptionsRecord(
      getAnthropicSettings(modelId),
    );
  }

  // OpenAI model responses should never be persisted.
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = toProviderOptionsRecord({
      store: false,
    } satisfies OpenAIResponsesProviderOptions);
  }

  // Apply OpenAI defaults for all GPT-5 variants to expose encrypted reasoning content.
  // This avoids Responses API failures when `store: false`, e.g.:
  // "Item with id 'rs_...' not found. Items are not persisted when `store` is set to false."
  if (shouldApplyOpenAIReasoningDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  if (shouldApplyOpenAITextVerbosityDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        textVerbosity: "low",
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  // Enforce OpenAI non-persistence even when custom provider overrides are present.
  if (modelId.startsWith("openai/")) {
    providerOptions.openai = mergeRecords(
      providerOptions.openai ?? {},
      toProviderOptionsRecord({
        store: false,
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  return providerOptions;
}

export function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): LanguageModel {
  const { config, directAnthropic, providerOptionsOverrides, appName, appUrl } =
    options;

  const attributionHeaders = {
    "http-referer": appUrl ?? "https://open-agents.dev",
    "x-title": appName ?? "Open Agents",
  };

  let model: WrappableLanguageModel;
  if (directAnthropic) {
    model = directAnthropicModel(directAnthropic, {
      appName,
      appUrl,
    });
  } else {
    const baseGateway = config
      ? createGateway({
          baseURL: config.baseURL,
          apiKey: config.apiKey,
          headers: attributionHeaders,
        })
      : createGateway({ headers: attributionHeaders });

    model = baseGateway(modelId);
  }

  const providerOptions = getProviderOptionsForModel(
    modelId,
    providerOptionsOverrides,
  );

  if (Object.keys(providerOptions).length > 0) {
    model = wrapLanguageModel({
      model,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  }

  return model;
}
