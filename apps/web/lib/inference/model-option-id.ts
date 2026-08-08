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

/**
 * Split a model selection into its model + inference profile pair (#1154).
 *
 * `modelId` may be a UI-transport composite
 * ("user-profile:<profileId>:<modelId>") or a plain provider model id. This
 * is the single shared write-boundary normalizer: reused by
 * `updateUserPreferences` and the three chat-creation routes so an internal
 * composite id never lands in a `modelId` column while its paired
 * `inferenceProfileId` column is null.
 *
 * `explicitInferenceProfileId` wins whenever it is a non-null value — pass
 * `undefined` or `null` to let a composite decode into its profile id.
 */
export function splitModelSelection(
  modelId: string,
  explicitInferenceProfileId: string | null | undefined,
): { modelId: string; inferenceProfileId: string | null } {
  const parsed = parseModelOptionSelection(modelId);
  return {
    modelId: parsed.modelId,
    inferenceProfileId: explicitInferenceProfileId ?? parsed.inferenceProfileId,
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
