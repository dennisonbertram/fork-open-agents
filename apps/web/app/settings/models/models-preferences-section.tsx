"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ModelCombobox } from "@/components/model-combobox";
import {
  ProviderIcon,
  getProviderDisplayName,
} from "@/components/provider-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelOptions } from "@/hooks/use-model-options";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import {
  type ModelOption,
  type ModelSortKey,
  filterAndSortModelOptions,
  getDefaultModelOptionId,
  withMissingModelOption,
} from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { MODEL_SYSTEM_PROMPT_MAX_LENGTH } from "@/lib/model-system-prompts";
import { SettingsSectionHeader } from "../_components/section-header";

function ModelSettingsSectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsSectionHeader title={String(children)} />;
}

export function ModelPreferencesSectionSkeleton() {
  return (
    <div className="space-y-4">
      <ModelSettingsSectionTitle>Model preferences</ModelSettingsSectionTitle>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton className="h-4 w-[34rem] max-w-full" />
        </div>
        <div className="rounded-lg border border-border/70">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="size-6 rounded-md" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  );
}

function useModelPreferencesSectionState() {
  const { preferences, loading, updatePreferences } = useUserPreferences();
  const { modelOptions, loading: modelOptionsLoading } = useModelOptions();
  const [isSaving, setIsSaving] = useState(false);

  // #1123: the default model and its inference profile are stored split, so
  // recompose the composite option id the pickers are keyed by.
  const selectedDefaultModelId =
    getModelOptionSelectionId(
      preferences?.defaultModelId,
      preferences?.defaultInferenceProfileId,
    ) || getDefaultModelOptionId(modelOptions);
  const selectedSubagentModelId = preferences?.defaultSubagentModelId ?? "auto";

  const defaultModelOptions = useMemo(
    () => withMissingModelOption(modelOptions, selectedDefaultModelId),
    [modelOptions, selectedDefaultModelId],
  );

  const subagentModelOptions = useMemo(
    () =>
      withMissingModelOption(modelOptions, preferences?.defaultSubagentModelId),
    [modelOptions, preferences?.defaultSubagentModelId],
  );

  const enabledModelIds = useMemo(
    () => new Set(preferences?.enabledModelIds),
    [preferences?.enabledModelIds],
  );

  const systemPromptModelOptions = useMemo(
    () => withMissingModelOption(modelOptions, selectedDefaultModelId),
    [modelOptions, selectedDefaultModelId],
  );

  const handleModelChange = async (modelId: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultModelId: modelId });
    } catch (error) {
      console.error("Failed to update model preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubagentModelChange = async (value: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({
        defaultSubagentModelId: value === "auto" ? null : value,
      });
    } catch (error) {
      console.error("Failed to update subagent model preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetEnabledModels = useCallback(
    async (nextIds: string[]) => {
      setIsSaving(true);
      try {
        await updatePreferences({ enabledModelIds: nextIds });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [updatePreferences],
  );

  const handleSaveModelSystemPrompt = useCallback(
    async (modelId: string, prompt: string) => {
      const trimmedPrompt = prompt.trim();
      const currentPrompts = preferences?.modelSystemPrompts ?? {};
      const nextPrompts = { ...currentPrompts };
      if (trimmedPrompt.length > 0) {
        nextPrompts[modelId] = trimmedPrompt;
      } else {
        delete nextPrompts[modelId];
      }

      setIsSaving(true);
      try {
        await updatePreferences({ modelSystemPrompts: nextPrompts });
      } catch (error) {
        console.error("Failed to update model system prompt:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences?.modelSystemPrompts, updatePreferences],
  );

  return {
    preferences,
    loading,
    modelOptions,
    modelOptionsLoading,
    isSaving,
    selectedDefaultModelId,
    selectedSubagentModelId,
    defaultModelOptions,
    subagentModelOptions,
    systemPromptModelOptions,
    enabledModelIds,
    handleModelChange,
    handleSubagentModelChange,
    handleSetEnabledModels,
    handleSaveModelSystemPrompt,
  };
}

function ModelSystemPromptSection({
  modelOptions,
  modelOptionsLoading,
  selectedDefaultModelId,
  modelSystemPrompts,
  onSavePrompt,
  disabled,
}: {
  modelOptions: ModelOption[];
  modelOptionsLoading: boolean;
  selectedDefaultModelId: string;
  modelSystemPrompts: Record<string, string>;
  onSavePrompt: (modelId: string, prompt: string) => void;
  disabled: boolean;
}) {
  const [selectedModelId, setSelectedModelId] = useState(
    selectedDefaultModelId,
  );
  const [draftPrompt, setDraftPrompt] = useState("");

  useEffect(() => {
    if (!selectedModelId) {
      setSelectedModelId(selectedDefaultModelId);
    }
  }, [selectedDefaultModelId, selectedModelId]);

  useEffect(() => {
    setDraftPrompt(modelSystemPrompts[selectedModelId] ?? "");
  }, [modelSystemPrompts, selectedModelId]);

  const modelItems = useMemo(
    () =>
      modelOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        isVariant: option.isVariant,
      })),
    [modelOptions],
  );

  const promptModelIds = useMemo(
    () =>
      Object.keys(modelSystemPrompts).filter((modelId) =>
        modelSystemPrompts[modelId]?.trim(),
      ),
    [modelSystemPrompts],
  );

  const promptModelLabels = useMemo(() => {
    const labels = new Map(modelOptions.map((option) => [option.id, option]));
    return promptModelIds.map((modelId) => {
      const option = labels.get(modelId);
      return {
        id: modelId,
        label: option?.label ?? modelId,
        description: option?.description ?? modelId,
      };
    });
  }, [modelOptions, promptModelIds]);

  const savedPrompt = modelSystemPrompts[selectedModelId] ?? "";
  const normalizedDraft = draftPrompt.trim();
  const hasChanges = normalizedDraft !== savedPrompt;
  const overLimit = draftPrompt.length > MODEL_SYSTEM_PROMPT_MAX_LENGTH;
  const canSave =
    Boolean(selectedModelId) && hasChanges && !overLimit && !disabled;

  if (modelOptionsLoading) {
    return (
      <div className="grid gap-2">
        <Label>Custom system prompts</Label>
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Label>Custom system prompts</Label>

      <div className="grid gap-2">
        <ModelCombobox
          value={selectedModelId}
          items={modelItems}
          placeholder="Select a model"
          searchPlaceholder="Search models..."
          emptyText="No models found."
          disabled={disabled || modelOptionsLoading}
          onChange={setSelectedModelId}
        />

        <Textarea
          id="model-system-prompt-model"
          value={draftPrompt}
          onChange={(event) => setDraftPrompt(event.target.value)}
          className="min-h-36 resize-y rounded-md border-border bg-muted/30 font-mono text-xs leading-relaxed"
          placeholder="Prefer concise status updates. Ask before risky operations. Run focused tests first."
          disabled={disabled}
          aria-label="Custom system prompt"
          aria-invalid={overLimit}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={
            overLimit
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {draftPrompt.length.toLocaleString()} /{" "}
          {MODEL_SYSTEM_PROMPT_MAX_LENGTH.toLocaleString()} characters
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !savedPrompt}
            onClick={() => onSavePrompt(selectedModelId, "")}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSave}
            onClick={() => onSavePrompt(selectedModelId, draftPrompt)}
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </div>
      </div>

      {promptModelLabels.length > 0 && (
        <div className="divide-y divide-border/60 rounded-lg border border-border/70">
          {promptModelLabels.map((model) => (
            <button
              key={model.id}
              type="button"
              disabled={disabled}
              onClick={() => setSelectedModelId(model.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {model.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {model.description}
                </span>
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                prompt
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function getEffectiveEnabledModelIdSet({
  enabledModelIds,
  modelOptions,
}: {
  enabledModelIds: ReadonlySet<string>;
  modelOptions: ModelOption[];
}): Set<string> {
  if (enabledModelIds.size === 0) {
    return new Set(modelOptions.map((option) => option.id));
  }

  const availableModelIds = new Set(modelOptions.map((option) => option.id));
  return new Set(
    Array.from(enabledModelIds).filter((modelId) =>
      availableModelIds.has(modelId),
    ),
  );
}

export function toEnabledModelPreferenceIds({
  modelOptions,
  selectedModelIds,
}: {
  modelOptions: ModelOption[];
  selectedModelIds: Iterable<string>;
}): string[] {
  const selectedModelIdSet = new Set(selectedModelIds);
  const selectedKnownIds = modelOptions
    .map((option) => option.id)
    .filter((modelId) => selectedModelIdSet.has(modelId));

  if (selectedKnownIds.length === modelOptions.length) {
    return [];
  }

  return selectedKnownIds;
}

const ALL_INFERENCE_SOURCE_ID = "all";
const GATEWAY_INFERENCE_SOURCE_ID = "gateway";
const USER_PROFILE_INFERENCE_SOURCE_PREFIX = "profile:";

type InferenceSourceFilter = string;

type InferenceSourceOption = {
  id: InferenceSourceFilter;
  label: string;
  modelCount: number;
};

function toProfileInferenceSourceId(profileId: string): string {
  return `${USER_PROFILE_INFERENCE_SOURCE_PREFIX}${profileId}`;
}

function fromProfileInferenceSourceId(sourceId: string): string | null {
  return sourceId.startsWith(USER_PROFILE_INFERENCE_SOURCE_PREFIX)
    ? sourceId.slice(USER_PROFILE_INFERENCE_SOURCE_PREFIX.length)
    : null;
}

export function buildInferenceSourceOptions(
  options: ModelOption[],
): InferenceSourceOption[] {
  const profileSources = new Map<
    string,
    { id: string; label: string; modelCount: number }
  >();
  let gatewayModelCount = 0;

  for (const option of options) {
    if (option.source === "user" && option.inferenceProfileId) {
      const sourceId = toProfileInferenceSourceId(option.inferenceProfileId);
      const existing = profileSources.get(sourceId);
      profileSources.set(sourceId, {
        id: sourceId,
        label:
          existing?.label ?? option.secondaryLabel ?? option.inferenceProfileId,
        modelCount: (existing?.modelCount ?? 0) + 1,
      });
      continue;
    }

    gatewayModelCount += 1;
  }

  return [
    {
      id: ALL_INFERENCE_SOURCE_ID,
      label: "All inference sources",
      modelCount: options.length,
    },
    ...(gatewayModelCount > 0
      ? [
          {
            id: GATEWAY_INFERENCE_SOURCE_ID,
            label: "Vercel AI Gateway",
            modelCount: gatewayModelCount,
          },
        ]
      : []),
    ...Array.from(profileSources.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  ];
}

export function filterModelOptionsByInferenceSource(
  options: ModelOption[],
  sourceId: InferenceSourceFilter,
): ModelOption[] {
  if (sourceId === ALL_INFERENCE_SOURCE_ID) {
    return options;
  }

  if (sourceId === GATEWAY_INFERENCE_SOURCE_ID) {
    return options.filter((option) => option.source !== "user");
  }

  const profileId = fromProfileInferenceSourceId(sourceId);
  if (profileId) {
    return options.filter(
      (option) =>
        option.source === "user" && option.inferenceProfileId === profileId,
    );
  }

  return options;
}

export function deriveModelProvidersForInferenceSource(
  options: ModelOption[],
  sourceId: InferenceSourceFilter,
): string[] {
  return deriveModelProviders(
    filterModelOptionsByInferenceSource(options, sourceId),
  );
}

function deriveModelProviders(options: ModelOption[]): string[] {
  return Array.from(new Set(options.map((option) => option.provider))).sort(
    (a, b) =>
      getProviderDisplayName(a).localeCompare(getProviderDisplayName(b)),
  );
}

export const ENABLED_MODELS_LIST_CLASS_NAME =
  "max-h-[10.5rem] overflow-y-auto overflow-x-hidden";

export const ENABLED_MODELS_ROW_CLASS_NAME =
  "grid w-full max-w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-60";

export const ENABLED_MODELS_BULK_ACTION_LABELS = [
  "Select all",
  "Clear all",
] as const;

export function clearVisibleModelSelection({
  allModelIds,
  currentSelectedIds,
  visibleModelIds,
}: {
  allModelIds: string[];
  currentSelectedIds: Iterable<string>;
  visibleModelIds: Iterable<string>;
}): string[] {
  const selected = new Set(currentSelectedIds);
  const visible = new Set(visibleModelIds);
  const next = allModelIds.filter((modelId) => {
    return selected.has(modelId) && !visible.has(modelId);
  });

  if (next.length > 0 || allModelIds.length === 0) {
    return next;
  }

  return [allModelIds[0]];
}

function EnabledModelsSection({
  modelOptions,
  modelOptionsLoading,
  enabledModelIds,
  onSetEnabledModels,
  disabled,
}: {
  modelOptions: ModelOption[];
  modelOptionsLoading: boolean;
  enabledModelIds: Set<string>;
  onSetEnabledModels: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [inferenceSourceFilter, setInferenceSourceFilter] =
    useState<InferenceSourceFilter>(ALL_INFERENCE_SOURCE_ID);
  const [sort, setSort] = useState<ModelSortKey>("provider");
  const [selectedOnly, setSelectedOnly] = useState(false);

  const isShowingAllModels = enabledModelIds.size === 0;
  const effectiveEnabledModelIds = useMemo(
    () =>
      getEffectiveEnabledModelIdSet({
        enabledModelIds,
        modelOptions,
      }),
    [enabledModelIds, modelOptions],
  );
  const inferenceSources = useMemo(
    () => buildInferenceSourceOptions(modelOptions),
    [modelOptions],
  );
  const effectiveInferenceSourceFilter = inferenceSources.some(
    (source) => source.id === inferenceSourceFilter,
  )
    ? inferenceSourceFilter
    : ALL_INFERENCE_SOURCE_ID;
  const sourceFilteredOptions = useMemo(
    () =>
      filterModelOptionsByInferenceSource(
        modelOptions,
        effectiveInferenceSourceFilter,
      ),
    [effectiveInferenceSourceFilter, modelOptions],
  );
  const providers = useMemo(
    () =>
      deriveModelProvidersForInferenceSource(
        modelOptions,
        effectiveInferenceSourceFilter,
      ),
    [effectiveInferenceSourceFilter, modelOptions],
  );
  const effectiveProviderFilter =
    providerFilter === "all" || providers.includes(providerFilter)
      ? providerFilter
      : "all";
  const visibleOptions = useMemo(
    () =>
      filterAndSortModelOptions(sourceFilteredOptions, {
        providerFilter: effectiveProviderFilter,
        search,
        selectedIds: effectiveEnabledModelIds,
        selectedOnly,
        sort,
      }),
    [
      effectiveProviderFilter,
      effectiveEnabledModelIds,
      search,
      selectedOnly,
      sourceFilteredOptions,
      sort,
    ],
  );

  const handleInferenceSourceChange = useCallback((sourceId: string) => {
    setInferenceSourceFilter(sourceId);
    setProviderFilter("all");
  }, []);

  const commitSelectedIds = useCallback(
    (nextSelectedIds: Iterable<string>) => {
      const nextPreferenceIds = toEnabledModelPreferenceIds({
        modelOptions,
        selectedModelIds: nextSelectedIds,
      });

      if (nextPreferenceIds.length === 0 && modelOptions.length > 0) {
        onSetEnabledModels([]);
        return;
      }

      onSetEnabledModels(nextPreferenceIds);
    },
    [modelOptions, onSetEnabledModels],
  );

  const handleToggleModel = useCallback(
    (modelId: string) => {
      const nextSelectedIds = new Set(effectiveEnabledModelIds);
      if (nextSelectedIds.has(modelId)) {
        if (nextSelectedIds.size <= 1) {
          return;
        }
        nextSelectedIds.delete(modelId);
      } else {
        nextSelectedIds.add(modelId);
      }

      commitSelectedIds(nextSelectedIds);
    },
    [commitSelectedIds, effectiveEnabledModelIds],
  );

  const handleSelectAll = useCallback(() => {
    const nextSelectedIds = new Set(effectiveEnabledModelIds);
    for (const option of visibleOptions) {
      nextSelectedIds.add(option.id);
    }
    commitSelectedIds(nextSelectedIds);
  }, [commitSelectedIds, effectiveEnabledModelIds, visibleOptions]);

  const handleClearAll = useCallback(() => {
    if (visibleOptions.length === 0) {
      return;
    }
    commitSelectedIds(
      clearVisibleModelSelection({
        allModelIds: modelOptions.map((option) => option.id),
        currentSelectedIds: effectiveEnabledModelIds,
        visibleModelIds: visibleOptions.map((option) => option.id),
      }),
    );
  }, [
    commitSelectedIds,
    effectiveEnabledModelIds,
    modelOptions,
    visibleOptions,
  ]);

  if (modelOptionsLoading) {
    return (
      <div className="grid gap-2">
        <Label>Models shown in pickers</Label>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const enabledCount = effectiveEnabledModelIds.size;
  const totalCount = modelOptions.length;
  const hasUnselectedVisibleModels = visibleOptions.some(
    (option) => !effectiveEnabledModelIds.has(option.id),
  );
  const hasSelectedVisibleModels = visibleOptions.some((option) =>
    effectiveEnabledModelIds.has(option.id),
  );
  const canSelectAll = !disabled && hasUnselectedVisibleModels;
  const canClearAll =
    !disabled && hasSelectedVisibleModels && effectiveEnabledModelIds.size > 1;

  return (
    <div className="grid gap-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label>Models shown in pickers</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {isShowingAllModels
              ? `Showing all ${totalCount} models`
              : `Showing ${enabledCount} of ${totalCount} models`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Controls which models appear in chat, default model, and subagent
          pickers. Show everything, or narrow the list when providers expose
          more models than you want to scan while working.
        </p>
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-border/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-2">
          {inferenceSources.length > 1 && (
            <Select
              value={effectiveInferenceSourceFilter}
              onValueChange={handleInferenceSourceChange}
              disabled={disabled}
            >
              <SelectTrigger
                size="sm"
                aria-label="Filter models by inference source"
                className="w-[13.5rem]"
              >
                <SelectValue placeholder="Inference source" />
              </SelectTrigger>
              <SelectContent>
                {inferenceSources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models..."
              disabled={disabled}
              className="h-8 pl-9 pr-8 text-sm"
              aria-label="Search models shown in pickers"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear model search"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {providers.length > 1 && (
            <Select
              value={effectiveProviderFilter}
              onValueChange={setProviderFilter}
              disabled={disabled}
            >
              <SelectTrigger
                size="sm"
                aria-label="Filter models by provider"
                className="w-[8.5rem]"
              >
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {getProviderDisplayName(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={sort}
            onValueChange={(value) => setSort(value as ModelSortKey)}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              aria-label="Sort models"
              className="w-[7.5rem]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="provider">Provider</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
              <SelectItem value="cost-asc">Cost low-high</SelectItem>
              <SelectItem value="cost-desc">Cost high-low</SelectItem>
            </SelectContent>
          </Select>

          <button
            type="button"
            aria-pressed={selectedOnly}
            disabled={disabled}
            onClick={() => setSelectedOnly((value) => !value)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
              selectedOnly
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Selected only
          </button>

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {visibleOptions.length === totalCount
              ? `${totalCount} models`
              : `${visibleOptions.length} of ${totalCount}`}
          </span>
        </div>

        <div className={ENABLED_MODELS_LIST_CLASS_NAME}>
          {visibleOptions.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No models match these filters.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {visibleOptions.map((option) => {
                const isSelected = effectiveEnabledModelIds.has(option.id);
                const cannotRemoveLastModel =
                  isSelected && effectiveEnabledModelIds.size <= 1;

                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled || cannotRemoveLastModel}
                    onClick={() => handleToggleModel(option.id)}
                    className={ENABLED_MODELS_ROW_CLASS_NAME}
                    aria-pressed={isSelected}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </span>

                    {option.source === "user" ? (
                      <span
                        className="flex size-3.5 shrink-0 items-center justify-center"
                        title="Uses your personal provider key"
                      >
                        <span
                          aria-label="Your personal provider key"
                          className="size-2 rounded-full bg-emerald-500"
                        />
                      </span>
                    ) : (
                      <ProviderIcon
                        provider={option.provider}
                        className="size-3.5 shrink-0 opacity-70"
                      />
                    )}

                    <span className="min-w-0 overflow-hidden">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {option.shortLabel}
                        </span>
                        {option.isVariant && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            variant
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.secondaryLabel
                          ? `via ${option.secondaryLabel}`
                          : (option.description ?? option.id)}
                      </span>
                    </span>

                    <span className="hidden max-w-24 shrink-0 truncate text-xs text-muted-foreground sm:block">
                      {option.source === "user"
                        ? (option.secondaryLabel ?? "Your key")
                        : getProviderDisplayName(option.provider)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canSelectAll}
              onClick={handleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {ENABLED_MODELS_BULK_ACTION_LABELS[0]}
            </button>
            <button
              type="button"
              disabled={!canClearAll}
              onClick={handleClearAll}
              className="text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {ENABLED_MODELS_BULK_ACTION_LABELS[1]}
            </button>
          </div>

          <span className="text-xs text-muted-foreground tabular-nums">
            {isShowingAllModels
              ? "All models visible"
              : `${enabledCount} selected`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ModelPreferencesSection() {
  const state = useModelPreferencesSectionState();

  if (state.loading) {
    return <ModelPreferencesSectionSkeleton />;
  }

  const {
    defaultModelOptions,
    selectedDefaultModelId,
    selectedSubagentModelId,
    subagentModelOptions,
    systemPromptModelOptions,
    modelOptions,
    modelOptionsLoading,
    enabledModelIds,
    isSaving,
    preferences,
    handleModelChange,
    handleSubagentModelChange,
    handleSetEnabledModels,
    handleSaveModelSystemPrompt,
  } = state;

  return (
    <div className="space-y-4">
      <ModelSettingsSectionTitle>Model preferences</ModelSettingsSectionTitle>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="model">Default model</Label>
          <ModelCombobox
            value={selectedDefaultModelId}
            items={defaultModelOptions.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
              isVariant: option.isVariant,
              provider: option.provider,
            }))}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
            emptyText={modelOptionsLoading ? "Loading..." : "No models found."}
            disabled={isSaving || modelOptionsLoading}
            onChange={handleModelChange}
          />
          <p className="text-xs text-muted-foreground">
            The AI model used for new chats.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="subagent-model">Subagent model</Label>
          <ModelCombobox
            value={selectedSubagentModelId}
            items={[
              { id: "auto", label: "Same as main model" },
              ...subagentModelOptions.map((option) => ({
                id: option.id,
                label: option.label,
                description: option.description,
                isVariant: option.isVariant,
                provider: option.provider,
              })),
            ]}
            placeholder="Select a model"
            searchPlaceholder="Search models..."
            emptyText={modelOptionsLoading ? "Loading..." : "No models found."}
            disabled={isSaving || modelOptionsLoading}
            onChange={handleSubagentModelChange}
          />
          <p className="text-xs text-muted-foreground">
            For explorer and executor subagents.
          </p>
        </div>
      </div>

      <EnabledModelsSection
        modelOptions={modelOptions}
        modelOptionsLoading={modelOptionsLoading}
        enabledModelIds={enabledModelIds}
        onSetEnabledModels={handleSetEnabledModels}
        disabled={isSaving}
      />

      <ModelSystemPromptSection
        modelOptions={systemPromptModelOptions}
        modelOptionsLoading={modelOptionsLoading}
        selectedDefaultModelId={selectedDefaultModelId}
        modelSystemPrompts={preferences?.modelSystemPrompts ?? {}}
        onSavePrompt={handleSaveModelSystemPrompt}
        disabled={isSaving}
      />
    </div>
  );
}
