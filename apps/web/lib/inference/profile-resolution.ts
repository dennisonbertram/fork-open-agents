import "server-only";

import {
  toAnthropicDirectModelId,
  type AgentModelSelection,
} from "@open-agents/agent";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
} from "@/lib/db/inference-profiles";

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

  if (profile.provider !== "anthropic") {
    throw new InferenceProfileResolutionError(
      "Selected inference profile uses an unsupported provider.",
    );
  }

  const directModelId = toAnthropicDirectModelId(selection.id);
  if (!directModelId) {
    throw new InferenceProfileResolutionError(
      "Selected inference profile only supports Anthropic models. Choose an Anthropic User model or switch back to Vercel AI Gateway.",
    );
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
