export const USER_INFERENCE_OPTION_PREFIX = "user-profile:";

export interface ParsedModelOptionSelection {
  modelId: string;
  inferenceProfileId: string | null;
}

export function createUserInferenceModelOptionId(
  inferenceProfileId: string,
  modelId: string,
): string {
  return `${USER_INFERENCE_OPTION_PREFIX}${encodeURIComponent(
    inferenceProfileId,
  )}:${encodeURIComponent(modelId)}`;
}

export function parseModelOptionSelection(
  optionId: string,
): ParsedModelOptionSelection {
  if (!optionId.startsWith(USER_INFERENCE_OPTION_PREFIX)) {
    return {
      modelId: optionId,
      inferenceProfileId: null,
    };
  }

  const rest = optionId.slice(USER_INFERENCE_OPTION_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) {
    return {
      modelId: optionId,
      inferenceProfileId: null,
    };
  }

  const profileId = decodeURIComponent(rest.slice(0, separatorIndex));
  const modelId = decodeURIComponent(rest.slice(separatorIndex + 1));

  if (!profileId || !modelId) {
    return {
      modelId: optionId,
      inferenceProfileId: null,
    };
  }

  return {
    modelId,
    inferenceProfileId: profileId,
  };
}

export function getModelOptionSelectionId(
  modelId: string | null | undefined,
  inferenceProfileId: string | null | undefined,
): string {
  if (!modelId) {
    return "";
  }

  if (!inferenceProfileId) {
    return modelId;
  }

  return createUserInferenceModelOptionId(inferenceProfileId, modelId);
}
