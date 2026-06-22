import "server-only";

import {
  toAnthropicDirectModelId,
  type AgentModelSelection,
} from "@open-agents/agent";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
} from "@/lib/db/inference-profiles";
import {
  getInferenceProfileModelProviderDisplayName,
  toAnthropicCompatibleProfileModelId,
  toOpenAICompatibleProfileModelId,
} from "@/lib/inference/profile-models";

export class InferenceProfileResolutionError extends Error {
  override name = "InferenceProfileResolutionError";
}

export async function resolveInferenceProfileModelSelection(params: {
  userId: string;
  inferenceProfileId: string | null | undefined;
  selection: AgentModelSelection;
}): Promise<AgentModelSelection> {
  const { inferenceProfileId, selection, userId } = params;

  if (!inferenceProfileId) {
    return {
      ...selection,
      attribution: {
        inferenceRoute: "gateway",
        provider: selection.id.split("/")[0],
      },
    };
  }

  const profile = await getInferenceProfileByIdForUser(
    userId,
    inferenceProfileId,
  );
  if (!profile || !profile.enabled) {
    throw new InferenceProfileResolutionError(
      "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
    );
  }

  const directModelId =
    profile.provider === "openai-compatible"
      ? toOpenAICompatibleProfileModelId(profile, selection.id)
      : toAnthropicCompatibleProfileModelId(
          profile,
          selection.id,
          toAnthropicDirectModelId,
        );
  if (!directModelId) {
    const providerName = getInferenceProfileModelProviderDisplayName(profile);
    throw new InferenceProfileResolutionError(
      `Selected inference profile only supports ${providerName} models. Choose a matching User model or switch back to Vercel AI Gateway.`,
    );
  }

  if (profile.provider === "openai-compatible") {
    if (!profile.baseUrl) {
      throw new InferenceProfileResolutionError(
        "Selected OpenAI-compatible inference profile is missing a base URL. Update it in Settings → Models.",
      );
    }

    return {
      ...selection,
      directOpenAICompatible: {
        provider: "openai-compatible",
        name: profile.name,
        modelId: directModelId,
        apiKey: decryptInferenceProfileApiKey(profile),
        baseURL: profile.baseUrl,
      },
      attribution: {
        inferenceRoute: "user",
        inferenceProfileId: profile.id,
        inferenceProfileName: profile.name,
        provider: profile.provider,
      },
    };
  }

  return {
    ...selection,
    directAnthropic: {
      provider: "anthropic",
      modelId: directModelId,
      apiKey: decryptInferenceProfileApiKey(profile),
      ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
    },
    attribution: {
      inferenceRoute: "user",
      inferenceProfileId: profile.id,
      inferenceProfileName: profile.name,
      provider: profile.provider,
    },
  };
}
