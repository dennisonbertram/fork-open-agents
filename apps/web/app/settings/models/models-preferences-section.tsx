"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ModelCombobox } from "@/components/model-combobox";
import { useModelOptions } from "@/hooks/use-model-options";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import {
  type ModelOption,
  getDefaultModelOptionId,
  withMissingModelOption,
} from "@/lib/model-options";
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

  const selectedDefaultModelId =
    preferences?.defaultModelId ?? getDefaultModelOptionId(modelOptions);
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

  const handleAddModel = useCallback(
    async (modelId: string) => {
      const currentIds = preferences?.enabledModelIds ?? [];
      if (currentIds.includes(modelId)) return;
      setIsSaving(true);
      try {
        await updatePreferences({ enabledModelIds: [...currentIds, modelId] });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences?.enabledModelIds, updatePreferences],
  );

  const handleRemoveModel = useCallback(
    async (modelId: string) => {
      const currentIds = preferences?.enabledModelIds ?? [];
      setIsSaving(true);
      try {
        await updatePreferences({
          enabledModelIds: currentIds.filter((id) => id !== modelId),
        });
      } catch (error) {
        console.error("Failed to update enabled models:", error);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences?.enabledModelIds, updatePreferences],
  );

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
    handleAddModel,
    handleRemoveModel,
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

function EnabledModelsSection({
  modelOptions,
  modelOptionsLoading,
  enabledModelIds,
  onAddModel,
  onRemoveModel,
  onSetEnabledModels,
  disabled,
}: {
  modelOptions: ModelOption[];
  modelOptionsLoading: boolean;
  enabledModelIds: Set<string>;
  onAddModel: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  onSetEnabledModels: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabledCount = enabledModelIds.size;

  const enabledOptions = useMemo(
    () => modelOptions.filter((option) => enabledModelIds.has(option.id)),
    [modelOptions, enabledModelIds],
  );

  const availableOptions = useMemo(() => {
    const opts = modelOptions.filter(
      (option) => !enabledModelIds.has(option.id),
    );
    if (!search.trim()) return opts;
    const lower = search.toLowerCase();
    return opts.filter(
      (option) =>
        option.label.toLowerCase().includes(lower) ||
        option.id.toLowerCase().includes(lower) ||
        (option.description?.toLowerCase().includes(lower) ?? false),
    );
  }, [modelOptions, enabledModelIds, search]);

  const handleDeselectAll = () => {
    onSetEnabledModels([]);
  };

  const handleAdd = (modelId: string) => {
    onAddModel(modelId);
    setSearch("");
    inputRef.current?.focus();
  };

  if (modelOptionsLoading) {
    return (
      <div className="grid gap-2">
        <Label>Custom model set</Label>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label>Custom model set</Label>
          {enabledCount > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleDeselectAll}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {enabledCount === 0
            ? "By default, every available model is shown in the model selector. Add models here to create a shortlist of just the ones you use."
            : `The model selector will only show ${enabledCount === 1 ? "this model" : `these ${enabledCount} models`}. Remove all to go back to showing every model.`}
        </p>
      </div>

      {enabledOptions.length > 0 && (
        <div className="divide-y divide-border/60 rounded-lg border border-border/70">
          {enabledOptions.map((option) => (
            <div key={option.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {option.label}
                  </span>
                  {option.isVariant && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      variant
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {option.id}
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemoveModel(option.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                aria-label={`Remove ${option.label}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Search to add a model..."
            disabled={disabled}
            className="pl-9"
          />
        </div>
        {dropdownOpen && (
          <>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop dismiss */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => {
                setDropdownOpen(false);
                setSearch("");
              }}
            />
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
              <div className="max-h-60 overflow-y-auto">
                {availableOptions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {search.trim()
                      ? "No matching models."
                      : "All models have been added."}
                  </p>
                ) : (
                  availableOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleAdd(option.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                    >
                      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {option.label}
                          </span>
                          {option.isVariant && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              variant
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {option.description ?? option.id}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
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
    handleAddModel,
    handleRemoveModel,
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
        onAddModel={handleAddModel}
        onRemoveModel={handleRemoveModel}
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
