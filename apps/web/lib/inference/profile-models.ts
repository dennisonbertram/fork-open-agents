type InferenceProfileLike = {
  name: string;
  provider: string;
  baseUrl: string | null;
  modelIds?: string[] | null;
};

export const CURSOR_OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:8787/v1";

export const CURSOR_OPENAI_COMPATIBLE_MODEL_IDS = [
  "composer-2.5",
  "composer-2.5-fast",
] as const;

const FIREWORKS_GATEWAY_MODEL_IDS = new Set([
  "deepseek/deepseek-v3.1",
  "deepseek/deepseek-v4-flash",
  "zai/glm-5.2",
]);

function getProviderFromModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(0, slashIndex);
}

function getModelProvider(modelId: string, providerHint?: string): string {
  if (
    modelId.startsWith("fireworks/") ||
    modelId.startsWith("accounts/fireworks/models/")
  ) {
    return "fireworks";
  }

  if (FIREWORKS_GATEWAY_MODEL_IDS.has(modelId)) {
    return "fireworks";
  }

  if (providerHint) {
    return providerHint;
  }

  return getProviderFromModelId(modelId);
}

function isZaiProfile(profile: InferenceProfileLike): boolean {
  const text = `${profile.name} ${profile.baseUrl ?? ""}`.toLowerCase();
  return (
    text.includes("zai") ||
    text.includes("z.ai") ||
    text.includes("glm") ||
    text.includes("bigmodel") ||
    text.includes("zhipu")
  );
}

function isFireworksProfile(profile: InferenceProfileLike): boolean {
  const text = `${profile.name} ${profile.baseUrl ?? ""}`.toLowerCase();
  return text.includes("fireworks") || text.includes("api.fireworks.ai");
}

function isCursorProfile(profile: InferenceProfileLike): boolean {
  if (profile.provider !== "openai-compatible") {
    return false;
  }

  const text = `${profile.name} ${profile.baseUrl ?? ""}`.toLowerCase();
  const modelIds = profile.modelIds ?? [];
  return (
    text.includes("cursor") ||
    text.includes("api-for-cursor") ||
    text.includes("127.0.0.1:8787") ||
    text.includes("localhost:8787") ||
    modelIds.some((modelId) => modelId.toLowerCase().startsWith("composer-"))
  );
}

export function getInferenceProfileModelProvider(
  profile: InferenceProfileLike,
): string {
  if (isCursorProfile(profile)) {
    return "cursor";
  }

  if (profile.provider === "openai-compatible") {
    return "openai-compatible";
  }

  if (profile.provider === "anthropic" && isFireworksProfile(profile)) {
    return "fireworks";
  }

  if (profile.provider === "anthropic" && isZaiProfile(profile)) {
    return "zai";
  }

  return profile.provider;
}

export function getInferenceProfileModelProviderDisplayName(
  profile: InferenceProfileLike,
): string {
  const provider = getInferenceProfileModelProvider(profile);
  if (provider === "zai") {
    return "ZAI";
  }
  if (provider === "fireworks") {
    return "Fireworks";
  }
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "openai-compatible") {
    return "OpenAI-compatible";
  }
  if (provider === "cursor") {
    return "Cursor";
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function toOpenAICompatibleProfileModelId(
  profile: InferenceProfileLike,
  modelId: string,
): string | null {
  if (profile.provider !== "openai-compatible") {
    return null;
  }

  const profileModelIds = new Set(profile.modelIds);
  const slashIndex = modelId.indexOf("/");
  const providerlessModelId =
    slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);

  if (
    profileModelIds.has(modelId) ||
    profileModelIds.has(providerlessModelId)
  ) {
    return providerlessModelId;
  }

  return null;
}

export function isModelCompatibleWithInferenceProfile(
  profile: InferenceProfileLike,
  modelId: string,
  providerHint?: string,
): boolean {
  if (profile.provider === "openai-compatible") {
    return toOpenAICompatibleProfileModelId(profile, modelId) !== null;
  }

  return (
    getModelProvider(modelId, providerHint) ===
    getInferenceProfileModelProvider(profile)
  );
}

function toFireworksModelId(modelId: string): string {
  if (modelId.startsWith("accounts/fireworks/models/")) {
    return modelId;
  }

  const slashIndex = modelId.indexOf("/");
  const rawProviderlessModelId =
    slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
  const providerlessModelId = rawProviderlessModelId.replaceAll(".", "p");

  if (providerlessModelId.startsWith("accounts/")) {
    return providerlessModelId;
  }

  return `accounts/fireworks/models/${providerlessModelId}`;
}

export function toAnthropicCompatibleProfileModelId(
  profile: InferenceProfileLike,
  modelId: string,
  toAnthropicDirectModelId: (modelId: string) => string | null,
  providerHint?: string,
): string | null {
  const modelProvider = getInferenceProfileModelProvider(profile);

  if (modelProvider === "anthropic") {
    return toAnthropicDirectModelId(modelId);
  }

  if (getModelProvider(modelId, providerHint) !== modelProvider) {
    return null;
  }

  if (modelProvider === "fireworks") {
    return toFireworksModelId(modelId);
  }

  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}
