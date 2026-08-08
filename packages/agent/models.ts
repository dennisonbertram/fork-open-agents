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
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { toAnthropicDirectModelId } from "./model-ids";
import { createReasoningCompatibleFetch } from "./openai-compatible-reasoning-fetch";
import type { ProviderModelId } from "./provider-model-id";

type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

function supportsAdaptiveAnthropicThinking(modelId: string): boolean {
  // Adaptive thinking is supported for Claude 4.6 and later (4.x dotted format).
  //
  // Two distinct Anthropic model id formats exist:
  //   - Claude 3.x: claude-{major}-{minor}-{family}  e.g. claude-3-7-sonnet, claude-3-5-haiku
  //     These always use the LEGACY thinking path — never adaptive.
  //   - Claude 4.x+: claude-{family}-{major}[.{minor}]  e.g. claude-opus-4.8, claude-sonnet-4.6
  //     These use adaptive thinking at 4.6+.
  //
  // The regex `/claude-[a-z]+-(\d+)(?:\.(\d+))?(?:-|$)/i` anchors on a NON-DIGIT family word
  // between "claude-" and the version number, so 3.x ids (where a digit follows "claude-")
  // do not match and safely return false.
  //
  // Examples:
  //   - "claude-opus-4.8"   → family="opus", major=4, minor=8  → true  (8 >= 6)
  //   - "claude-sonnet-4.6" → family="sonnet", major=4, minor=6 → true  (6 >= 6)
  //   - "claude-opus-4.5"   → family="opus", major=4, minor=5  → false (5 < 6)
  //   - "claude-opus-4"     → family="opus", major=4, minor=0  → false (0 < 6)
  //   - "claude-3-7-sonnet" → no [a-z]+ between "claude-" and digit → no match → false
  //   - "claude-3-5-haiku"  → same → no match → false

  const versionMatch = modelId.match(/claude-[a-z]+-(\d+)(?:\.(\d+))?(?:-|$)/i);
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

export interface DirectOpenAIConfig {
  provider: "openai-compatible";
  modelId: string;
  apiKey: string;
  baseURL: string;
}

export type DirectInferenceConfig = DirectAnthropicConfig | DirectOpenAIConfig;

export interface GatewayOptions {
  config?: GatewayConfig;
  directInference?: DirectInferenceConfig;
  directAnthropic?: DirectAnthropicConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
  appName?: string;
  appUrl?: string;
}

export type { GatewayModelId, LanguageModel, JSONValue };

/**
 * A model choice resolved to a real provider id (never an unparsed internal
 * composite), plus the routing it should carry: BYOK/direct-inference config
 * and any provider option overrides. Shared by the main model, the subagent
 * default, and per-role roster overrides (`SubagentRosterEntry.modelSelection`
 * in `./subagents/roster`) so all three build through this file's `gateway()`
 * — the only place `directInference` actually reaches a provider call.
 *
 * Lives here (not in open-agent.ts, where it originated) because
 * `./subagents/roster` needs it too, and roster.ts cannot import from
 * open-agent.ts (open-agent.ts imports `SubagentRoster` from roster.ts).
 */
export interface AgentModelSelection {
  id: ProviderModelId;
  directInference?: DirectInferenceConfig;
  directAnthropic?: DirectAnthropicConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
  attribution?: {
    inferenceRoute?: "gateway" | "user";
    inferenceProfileId?: string;
    inferenceProfileName?: string;
    provider?: string;
  };
}

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

export { toAnthropicDirectModelId } from "./model-ids";

export function directAnthropicModel(
  config: DirectAnthropicConfig,
  options: Pick<GatewayOptions, "appName" | "appUrl"> = {},
): WrappableLanguageModel {
  const usesAuthToken = usesFireworksBearerAuth(config.baseURL);
  const attributionHeaders = {
    "http-referer": options.appUrl ?? "https://open-agents.dev",
    "x-title": options.appName ?? "Open Agents",
  };
  const anthropicProvider = createAnthropic({
    ...(usesAuthToken
      ? { authToken: config.apiKey }
      : { apiKey: config.apiKey }),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    headers: attributionHeaders,
  });

  return anthropicProvider(
    config.modelId as Parameters<typeof anthropicProvider>[0],
  ) as WrappableLanguageModel;
}

export function directOpenAIModel(
  config: DirectOpenAIConfig,
  options: Pick<GatewayOptions, "appName" | "appUrl"> = {},
): WrappableLanguageModel {
  const usesApiKeyAuth = usesBasetenApiKeyAuth(config.baseURL);
  const attributionHeaders = {
    "http-referer": options.appUrl ?? "https://open-agents.dev",
    "x-title": options.appName ?? "Open Agents",
  };
  const openAIProvider = createOpenAICompatible({
    name: "openai-compatible",
    baseURL: config.baseURL,
    ...(usesApiKeyAuth ? {} : { apiKey: config.apiKey }),
    headers: {
      ...attributionHeaders,
      ...(usesApiKeyAuth ? { Authorization: `Api-Key ${config.apiKey}` } : {}),
    },
    fetch: createReasoningCompatibleFetch(config.baseURL),
  });

  return openAIProvider.chatModel(
    config.modelId as Parameters<typeof openAIProvider.chatModel>[0],
  ) as WrappableLanguageModel;
}

function usesBasetenApiKeyAuth(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname === "inference.baseten.co";
  } catch {
    return false;
  }
}

function usesFireworksBearerAuth(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false;
  }

  try {
    return new URL(baseURL).hostname === "api.fireworks.ai";
  } catch {
    return false;
  }
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
  const {
    config,
    directInference,
    directAnthropic,
    providerOptionsOverrides,
    appName,
    appUrl,
  } = options;

  const attributionHeaders = {
    "http-referer": appUrl ?? "https://open-agents.dev",
    "x-title": appName ?? "Open Agents",
  };

  let model: WrappableLanguageModel;
  const directConfig = directInference ?? directAnthropic;
  if (directConfig) {
    if (directConfig.provider === "anthropic") {
      model = directAnthropicModel(directConfig, {
        appName,
        appUrl,
      });
    } else {
      model = directOpenAIModel(directConfig, {
        appName,
        appUrl,
      });
    }
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
