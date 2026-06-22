import type { ChatRecord, SessionRecord } from "./chat-context";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
} from "@/lib/db/inference-profiles";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  getInferenceProfileModelProviderDisplayName,
  isModelCompatibleWithInferenceProfile,
} from "@/lib/inference/profile-models";
import { getAllVariants } from "@/lib/model-variants";
import { resolveChatModelSelection } from "./model-selection";

export type InferenceProfilePreflight = {
  inferenceProfileId: string;
  inferenceProfileName: string | null;
  inferenceProvider: string | null;
  error: {
    name: string;
    message: string;
  } | null;
};

export async function preflightInferenceProfile(params: {
  userId: string;
  sessionRecord: SessionRecord;
  chat: ChatRecord;
}): Promise<InferenceProfilePreflight | null> {
  const preferences = await getUserPreferences(params.userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });
  const inferenceProfileId =
    params.chat.inferenceProfileId ??
    params.sessionRecord.inferenceProfileId ??
    preferences?.defaultInferenceProfileId ??
    null;

  if (!inferenceProfileId) {
    return null;
  }

  const modelVariants = getAllVariants(preferences?.modelVariants ?? []);
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId: params.chat.modelId ?? null,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });

  const profile = await getInferenceProfileByIdForUser(
    params.userId,
    inferenceProfileId,
  );
  if (!profile || !profile.enabled) {
    return {
      inferenceProfileId,
      inferenceProfileName: profile?.name ?? null,
      inferenceProvider: profile?.provider ?? null,
      error: {
        name: "InferenceProfileResolutionError",
        message:
          "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
      },
    };
  }

  if (!isModelCompatibleWithInferenceProfile(profile, mainModelSelection.id)) {
    const providerName = getInferenceProfileModelProviderDisplayName(profile);
    return {
      inferenceProfileId,
      inferenceProfileName: profile.name,
      inferenceProvider: profile.provider,
      error: {
        name: "InferenceProfileResolutionError",
        message: `Selected inference profile only supports ${providerName} models. Choose a matching User model or switch back to Vercel AI Gateway.`,
      },
    };
  }

  try {
    decryptInferenceProfileApiKey(profile);
  } catch (error) {
    return {
      inferenceProfileId,
      inferenceProfileName: profile.name,
      inferenceProvider: profile.provider,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  return {
    inferenceProfileId,
    inferenceProfileName: profile.name,
    inferenceProvider: profile.provider,
    error: null,
  };
}
