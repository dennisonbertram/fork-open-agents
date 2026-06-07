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
  getProviderFromModelId,
  stripProviderPrefix,
} from "@/components/provider-icons";

export interface ModelOption {
  id: string;
  label: string;
  shortLabel: string;
  description?: string;
  isVariant: boolean;
  contextWindow?: number;
  cost?: AvailableModelCost;
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
  return {
    id: model.id,
    label,
    shortLabel: stripProviderPrefix(label, provider),
    description: model.description ?? undefined,
    isVariant: false,
    contextWindow: model.context_window,
    ...(model.cost ? { cost: model.cost } : {}),
    provider,
    source: "catalog",
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
  const provider = getProviderFromModelId(model.id);

  return {
    id: createUserInferenceModelOptionId(profile.id, model.id),
    label,
    shortLabel: stripProviderPrefix(label, provider),
    description: `Direct Anthropic via ${profile.name}`,
    isVariant: false,
    contextWindow: model.context_window,
    ...(model.cost ? { cost: model.cost } : {}),
    provider: "user",
    source: "user",
    baseModelId: model.id,
    inferenceProfileId: profile.id,
    secondaryLabel: profile.name,
    searchText: [
      label,
      model.id,
      provider,
      profile.name,
      profile.provider,
      profile.baseUrl ?? "",
    ].join(" "),
  };
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

export type ModelSortKey = "name" | "provider";

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
      const haystack = [o.label, o.searchText ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  if (sort === "name") {
    filtered = [...filtered].sort((a, b) => a.label.localeCompare(b.label));
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
    .filter((profile) => profile.enabled && profile.provider === "anthropic")
    .flatMap((profile) =>
      models
        .filter((model) => model.id.startsWith("anthropic/"))
        .map((model) => toUserInferenceOption(profile, model)),
    );

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
        provider: "user",
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
