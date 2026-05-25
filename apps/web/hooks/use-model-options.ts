"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { buildModelOptions, type ModelOption } from "@/lib/model-options";
import type { SafeInferenceProfile } from "@/lib/inference/types";
import type { AvailableModel } from "@/lib/models";
import type { ModelVariant } from "@/lib/model-variants";
import { fetcher } from "@/lib/swr";

interface ModelsResponse {
  models: AvailableModel[];
}

interface ModelVariantsResponse {
  modelVariants: ModelVariant[];
}

interface InferenceProfilesResponse {
  profiles: SafeInferenceProfile[];
}

interface UseModelOptionsConfig {
  initialModelOptions?: ModelOption[];
}

const EMPTY_MODELS: AvailableModel[] = [];
const EMPTY_MODEL_VARIANTS: ModelVariant[] = [];
const EMPTY_INFERENCE_PROFILES: SafeInferenceProfile[] = [];
const EMPTY_MODEL_OPTIONS: ModelOption[] = [];

export function useModelOptions(config: UseModelOptionsConfig = {}) {
  const {
    data: modelsData,
    error: modelsError,
    isLoading: modelsLoading,
  } = useSWR<ModelsResponse>("/api/models", fetcher);

  const {
    data: variantsData,
    error: variantsError,
    isLoading: variantsLoading,
  } = useSWR<ModelVariantsResponse>("/api/settings/model-variants", fetcher);

  const {
    data: inferenceProfilesData,
    error: inferenceProfilesError,
    isLoading: inferenceProfilesLoading,
  } = useSWR<InferenceProfilesResponse>("/api/inference-profiles", fetcher);

  const models = modelsData?.models ?? EMPTY_MODELS;
  const modelVariants = variantsData?.modelVariants ?? EMPTY_MODEL_VARIANTS;
  const inferenceProfiles =
    inferenceProfilesData?.profiles ?? EMPTY_INFERENCE_PROFILES;
  const initialModelOptions = config.initialModelOptions ?? EMPTY_MODEL_OPTIONS;
  const hasCompleteFetchedData =
    modelsData !== undefined &&
    variantsData !== undefined &&
    inferenceProfilesData !== undefined;

  const fetchedModelOptions = useMemo<ModelOption[]>(
    () => buildModelOptions(models, modelVariants, inferenceProfiles),
    [models, modelVariants, inferenceProfiles],
  );

  const modelOptions =
    hasCompleteFetchedData || initialModelOptions.length === 0
      ? fetchedModelOptions
      : initialModelOptions;

  return {
    modelOptions,
    models,
    modelVariants,
    inferenceProfiles,
    loading:
      initialModelOptions.length === 0 &&
      !hasCompleteFetchedData &&
      (modelsLoading || variantsLoading || inferenceProfilesLoading),
    error:
      modelsError?.message ??
      variantsError?.message ??
      inferenceProfilesError?.message ??
      null,
  };
}
