import "server-only";

import {
  toAnthropicDirectModelId,
  type AgentModelSelection,
  type DirectInferenceConfig,
} from "@open-agents/agent";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
  INFERENCE_PROFILE_REENTER_KEY_MESSAGE,
  recordInferenceProfileTestResult,
} from "@/lib/db/inference-profiles";
import type { InferenceProfileProvider } from "@/lib/inference/types";
import { normalizeInferenceProfileBaseUrl } from "./model-routing";

export class InferenceProfileResolutionError extends Error {
  override name = "InferenceProfileResolutionError";
}

export type ExpectedInferenceProfileRoute = {
  provider: InferenceProfileProvider;
  baseUrl: string | null;
};

export async function assertInferenceProfileRouteAvailable(params: {
  userId: string;
  inferenceProfileId: string;
  provider: InferenceProfileProvider;
  baseUrl: string | null;
}) {
  const profile = await getInferenceProfileByIdForUser(
    params.userId,
    params.inferenceProfileId,
  );
  if (!profile || !profile.enabled) {
    throw new InferenceProfileResolutionError(
      "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
    );
  }

  const liveBaseUrl = normalizeInferenceProfileBaseUrl(
    profile.provider,
    profile.baseUrl,
  );
  if (profile.provider !== params.provider || liveBaseUrl !== params.baseUrl) {
    throw new InferenceProfileResolutionError(
      "Selected inference profile changed after this run was queued. Queue a new run to use the updated route.",
    );
  }

  return profile;
}

export async function resolveInferenceProfileModelSelection(params: {
  userId: string;
  inferenceProfileId: string | null | undefined;
  selection: AgentModelSelection;
  expectedRoute?: ExpectedInferenceProfileRoute;
}): Promise<AgentModelSelection> {
  const { expectedRoute, inferenceProfileId, selection, userId } = params;

  if (!inferenceProfileId) {
    return {
      ...selection,
      attribution: {
        inferenceRoute: "gateway",
        provider: selection.id.split("/")[0],
      },
    };
  }

  const profile = expectedRoute
    ? await assertInferenceProfileRouteAvailable({
        userId,
        inferenceProfileId,
        ...expectedRoute,
      })
    : await getInferenceProfileByIdForUser(userId, inferenceProfileId);
  if (!profile || !profile.enabled) {
    throw new InferenceProfileResolutionError(
      "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
    );
  }

  // Discovered provider models (e.g. ZAI's "glm-4.6") are sent to the
  // Anthropic-compatible endpoint verbatim. Only app-catalog ids carrying an
  // "anthropic/" prefix are mapped to Anthropic's direct model ids.
  const directModelId =
    profile.provider === "anthropic" && selection.id.startsWith("anthropic/")
      ? toAnthropicDirectModelId(selection.id)
      : selection.id;
  if (!directModelId) {
    throw new InferenceProfileResolutionError(
      profile.provider === "anthropic"
        ? "Selected inference profile only supports models served by its Anthropic-compatible endpoint. Choose one of the profile's models or switch back to Vercel AI Gateway."
        : "Selected inference profile only supports models discovered from its endpoint. Test the profile or switch back to Vercel AI Gateway.",
    );
  }
  let apiKey: string;
  try {
    apiKey = decryptInferenceProfileApiKey(profile);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "InferenceProfileResolutionError"
    ) {
      await recordInferenceProfileTestResult(userId, profile.id, {
        status: "failed",
        message: INFERENCE_PROFILE_REENTER_KEY_MESSAGE,
      });
    }

    throw error;
  }
  let directInference: DirectInferenceConfig;
  const baseUrl = normalizeInferenceProfileBaseUrl(
    profile.provider,
    profile.baseUrl,
  );
  if (profile.provider === "anthropic") {
    directInference = {
      provider: "anthropic",
      modelId: directModelId,
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    };
  } else {
    if (!baseUrl) {
      throw new InferenceProfileResolutionError(
        "Selected OpenAI-compatible inference profile is missing its base URL. Edit the profile or switch back to Vercel AI Gateway.",
      );
    }

    directInference = {
      provider: "openai-compatible",
      modelId: directModelId,
      apiKey,
      baseURL: baseUrl,
    };
  }

  return {
    ...selection,
    directInference,
    attribution: {
      inferenceRoute: "user",
      inferenceProfileId: profile.id,
      inferenceProfileName: profile.name,
      provider: profile.provider,
    },
  };
}
