import {
  APP_DEFAULT_MODEL_ID,
  type AvailableModel,
  type AvailableModelCost,
  getModelDisplayName,
} from "@/lib/models";
import {
  MODEL_VARIANT_ID_PREFIX,
  type ModelVariant,
} from "@/lib/model-variants";
import {
  USER_INFERENCE_OPTION_PREFIX,
  createUserInferenceModelOptionId,
  parseModelOptionSelection,
} from "@/lib/inference/model-option-id";
import type { SafeInferenceProfile } from "@/lib/inference/types";
import {
  getInferenceProfileModelProvider,
  getInferenceProfileModelProviderDisplayName,
  isModelCompatibleWithInferenceProfile,
} from "@/lib/inference/profile-models";
import {
  getProviderFromModelId,
  stripProviderPrefix,
} from "@/components/provider-icons";
import { deriveCostTier, deriveRoleHint } from "@/lib/model-roles";

export interface ModelOption {
  id: string;
  label: string;
  shortLabel: string;
  description?: string;
  isVariant: boolean;
  contextWindow?: number;
  cost?: AvailableModelCost;
  /** Cost-tier glyph: "$" | "$$" | "$$$", derived from cost.input. */
  costTier?: "$" | "$$" | "$$$";
  /** Short role hint, e.g. "Balanced", "Fast · Cheap", "Reasoning · 1M ctx". */
  roleHint?: string;
  provider: string;
  source?: "catalog" | "user";
  baseModelId?: string;
  inferenceProfileId?: string;
  secondaryLabel?: string;
  searchText?: string;
}

function toBaseModelOption(model: AvailableModel): ModelOption {
  const label = getModelDisplayName(model);
  const provider = getProviderFromModelId(model.id);
  const costTier = deriveCostTier(model.cost);
  const roleHint = deriveRoleHint(model.id);
  const contextStr =
    typeof model.context_window === "number"
      ? `${Math.round(model.context_window / 1000)}K`
      : "";
  const searchText = [provider, costTier ?? "", contextStr, roleHint ?? ""]
    .filter(Boolean)
    .join(" ");
  return {
    id: model.id,
    label,
    shortLabel: stripProviderPrefix(label, provider),
    description: model.description ?? undefined,
    isVariant: false,
    contextWindow: model.context_window,
    ...(model.cost ? { cost: model.cost } : {}),
    ...(costTier ? { costTier } : {}),
    ...(roleHint ? { roleHint } : {}),
    provider,
    source: "catalog",
    searchText,
  };
}

function toVariantOption(
  variant: ModelVariant,
  baseModel?: AvailableModel,
): ModelOption {
  const baseLabel = baseModel
    ? getModelDisplayName(baseModel)
    : variant.baseModelId;
  const provider = getProviderFromModelId(variant.baseModelId);

  return {
    id: variant.id,
    label: variant.name,
    shortLabel: stripProviderPrefix(variant.name, provider),
    description: `Variant of ${baseLabel}`,
    isVariant: true,
    contextWindow: baseModel?.context_window,
    ...(baseModel?.cost ? { cost: baseModel.cost } : {}),
    provider,
    source: "catalog",
    baseModelId: variant.baseModelId,
  };
}

function toUserInferenceOption(
  profile: SafeInferenceProfile,
  model: AvailableModel,
): ModelOption {
  const label = getModelDisplayName(model);
  const modelProvider = getProviderFromModelId(model.id);
  const provider = getInferenceProfileModelProvider(profile);
  const profileModelProviderName =
    getInferenceProfileModelProviderDisplayName(profile);

  return {
    id: createUserInferenceModelOptionId(profile.id, model.id),
    label,
    shortLabel: stripProviderPrefix(label, modelProvider),
    description: `Direct ${profileModelProviderName} via ${profile.name}`,
    isVariant: false,
    contextWindow: model.context_window,
    ...(model.cost ? { cost: model.cost } : {}),
    provider,
    source: "user",
    baseModelId: model.id,
    inferenceProfileId: profile.id,
    secondaryLabel: profile.name,
    searchText: [
      label,
      model.id,
      modelProvider,
      profile.name,
      profile.provider,
      provider,
      profile.baseUrl ?? "",
    ].join(" "),
  };
}

function toOpenAICompatibleUserInferenceOption(
  profile: SafeInferenceProfile,
  modelId: string,
): ModelOption {
  const provider = getInferenceProfileModelProvider(profile);
  const providerName = getInferenceProfileModelProviderDisplayName(profile);
  const providerPrefix =
    provider === "openai-compatible" ? "openai-compatible" : provider;
  const optionModelId = modelId.includes("/")
    ? modelId
    : `${providerPrefix}/${modelId}`;
  const shortLabel = modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;
  const label =
    provider === "cursor" ? formatCursorModelLabel(shortLabel) : modelId;

  return {
    id: createUserInferenceModelOptionId(profile.id, optionModelId),
    label,
    shortLabel: label,
    description: `Direct ${providerName} via ${profile.name}`,
    isVariant: false,
    provider,
    source: "user",
    baseModelId: optionModelId,
    inferenceProfileId: profile.id,
    secondaryLabel: profile.name,
    searchText: [
      label,
      modelId,
      optionModelId,
      "openai",
      "openai-compatible",
      provider,
      providerName,
      profile.name,
      profile.baseUrl ?? "",
    ].join(" "),
  };
}

function formatCursorModelLabel(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  if (normalized === "composer-2.5") {
    return "Composer 2.5";
  }
  if (normalized === "composer-2.5-fast") {
    return "Composer 2.5 Fast";
  }

  return modelId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3 && /\d/.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function getModelProviderHint(model: AvailableModel): string | undefined {
  return model.specification?.provider;
}

/** Providers pinned to the top of the list, in order. */
const PRIORITY_PROVIDERS = ["user", "anthropic", "openai"];

export interface ModelGroup {
  provider: string;
  label: string;
  options: ModelOption[];
}

/**
 * Group options by provider, sort groups (priority first, then alphabetical),
 * and within each group put base models before variants.
 */
export function groupByProvider(options: ModelOption[]): ModelGroup[] {
  const groups: Record<string, ModelOption[]> = {};
  const providers: string[] = [];
  for (const option of options) {
    const { provider } = option;
    if (!groups[provider]) {
      groups[provider] = [];
      providers.push(provider);
    }
    groups[provider].push(option);
  }

  // Sort: priority providers first (in order), then rest alphabetically
  providers.sort((a, b) => {
    const aIdx = PRIORITY_PROVIDERS.indexOf(a);
    const bIdx = PRIORITY_PROVIDERS.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  return providers.map((provider) => ({
    provider,
    label: provider,
    options: groups[provider],
  }));
}

export type ModelSortKey = "name" | "provider" | "cost-asc" | "cost-desc";

export interface ModelFilterOptions {
  /** Provider key to filter by, or "all" to include every provider. */
  providerFilter: string;
  /** Sort order: "name" = A–Z by label, "provider" = priority-provider order then label. */
  sort: ModelSortKey;
  /** Case-insensitive substring to match against label (and searchText if present). */
  search: string;
}

/**
 * Pure helper used by the model-manager dialog to filter and sort a flat list
 * of ModelOption objects.  No side-effects, safe to call in tests without DOM.
 */
export function filterAndSortModelOptions(
  options: ModelOption[],
  { providerFilter, sort, search }: ModelFilterOptions,
): ModelOption[] {
  const needle = search.trim().toLowerCase();

  let filtered = options;

  if (providerFilter !== "all") {
    filtered = filtered.filter((o) => o.provider === providerFilter);
  }

  if (needle) {
    filtered = filtered.filter((o) => {
      const haystack = [o.label, o.searchText ?? ""].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  if (sort === "name") {
    filtered = [...filtered].sort((a, b) => a.label.localeCompare(b.label));
  } else if (sort === "cost-asc" || sort === "cost-desc") {
    const direction = sort === "cost-asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const aInput = a.cost?.input;
      const bInput = b.cost?.input;
      // Models without cost data sink to the bottom regardless of direction
      if (typeof aInput !== "number" && typeof bInput !== "number") return 0;
      if (typeof aInput !== "number") return 1;
      if (typeof bInput !== "number") return -1;
      return (aInput - bInput) * direction;
    });
  } else {
    // sort === "provider": use priority-provider order, then alphabetical provider, then name
    filtered = [...filtered].sort((a, b) => {
      const aIdx = PRIORITY_PROVIDERS.indexOf(a.provider);
      const bIdx = PRIORITY_PROVIDERS.indexOf(b.provider);
      const provCmp =
        aIdx !== -1 && bIdx !== -1
          ? aIdx - bIdx
          : aIdx !== -1
            ? -1
            : bIdx !== -1
              ? 1
              : a.provider.localeCompare(b.provider);
      if (provCmp !== 0) return provCmp;
      return a.label.localeCompare(b.label);
    });
  }

  return filtered;
}

/**
 * Curated list of model IDs to show by default when the user's shortlist is
 * empty.  Spans fast/cheap, balanced, reasoning, and long-context tiers across
 * the three major providers.  At runtime these are intersected with the live
 * catalog so dead IDs never appear in the picker.
 */
export const RECOMMENDED_MODEL_IDS = [
  "openai/gpt-5.4", // Balanced default, APP_DEFAULT_MODEL_ID
  "openai/gpt-5.4-nano", // Fast / cheap OpenAI
  "openai/gpt-5.5", // Premium OpenAI
  "anthropic/claude-haiku-4.5", // Fast / cheap Anthropic
  "anthropic/claude-opus-4.6", // Reasoning + long-context (1M ctx)
  "anthropic/claude-sonnet-4-6", // Balanced Anthropic (1M ctx)
  "google/gemini-2.5-flash", // Long-context Google (1M ctx)
  "google/gemini-2.0-flash", // Cheapest capable model
] as const;

/**
 * From a full catalog of options, return only the entries whose ID is in
 * RECOMMENDED_MODEL_IDS, or whose source is "user" (always shown).
 * IDs absent from the live catalog are silently omitted, so no phantom/dead
 * models can appear.
 */
export function buildRecommendedModelOptions(
  allOptions: ModelOption[],
): ModelOption[] {
  const recommendedSet = new Set<string>(RECOMMENDED_MODEL_IDS);
  return allOptions.filter(
    (option) => option.source === "user" || recommendedSet.has(option.id),
  );
}

export function buildModelOptions(
  models: AvailableModel[],
  modelVariants: ModelVariant[],
  inferenceProfiles: SafeInferenceProfile[] = [],
): ModelOption[] {
  const baseModelOptions = models.map(toBaseModelOption);
  const baseModelsById = new Map(models.map((model) => [model.id, model]));

  const variantOptions = modelVariants.map((variant) =>
    toVariantOption(variant, baseModelsById.get(variant.baseModelId)),
  );

  const userInferenceOptions = inferenceProfiles
    .filter(
      (profile) =>
        profile.enabled &&
        (profile.provider === "anthropic" ||
          profile.provider === "openai-compatible"),
    )
    .flatMap((profile) => {
      if (profile.provider === "openai-compatible") {
        return profile.modelIds.map((modelId) =>
          toOpenAICompatibleUserInferenceOption(profile, modelId),
        );
      }

      return models
        .filter((model) =>
          isModelCompatibleWithInferenceProfile(
            profile,
            model.id,
            getModelProviderHint(model),
          ),
        )
        .map((model) => toUserInferenceOption(profile, model));
    });

  return [...userInferenceOptions, ...baseModelOptions, ...variantOptions];
}

export function buildSessionChatModelOptions(
  models: AvailableModel[],
  modelVariants: ModelVariant[],
  inferenceProfiles: SafeInferenceProfile[] = [],
): ModelOption[] {
  return buildModelOptions(models, modelVariants, inferenceProfiles);
}

export function withMissingModelOption(
  modelOptions: ModelOption[],
  modelId: string | null | undefined,
): ModelOption[] {
  if (!modelId || modelOptions.some((option) => option.id === modelId)) {
    return modelOptions;
  }

  if (modelId.startsWith(USER_INFERENCE_OPTION_PREFIX)) {
    const parsed = parseModelOptionSelection(modelId);
    const label = `${parsed.modelId} (missing profile)`;

    return [
      ...modelOptions,
      {
        id: modelId,
        label,
        shortLabel: label,
        description: "Inference profile no longer exists",
        isVariant: false,
        contextWindow: undefined,
        provider: parsed.modelId.split("/")[0] ?? "user",
        source: "user",
        baseModelId: parsed.modelId,
        inferenceProfileId: parsed.inferenceProfileId ?? undefined,
      },
    ];
  }

  if (!modelId.startsWith(MODEL_VARIANT_ID_PREFIX)) {
    return modelOptions;
  }

  const label = `${modelId.slice(MODEL_VARIANT_ID_PREFIX.length)} (missing)`;

  return [
    ...modelOptions,
    {
      id: modelId,
      label,
      shortLabel: label,
      description: "Variant no longer exists",
      isVariant: true,
      contextWindow: undefined,
      provider: "unknown",
    },
  ];
}

export function getDefaultModelOptionId(modelOptions: ModelOption[]): string {
  if (modelOptions.some((option) => option.id === APP_DEFAULT_MODEL_ID)) {
    return APP_DEFAULT_MODEL_ID;
  }

  return modelOptions[0]?.id ?? APP_DEFAULT_MODEL_ID;
}
