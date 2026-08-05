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
import {
  parseModelOptionSelection,
  USER_INFERENCE_OPTION_PREFIX,
} from "./model-option-id";
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
  const { expectedRoute, selection, userId } = params;

  // #1123 — defence in depth. "user-profile:<profileId>:<modelId>" is an
  // internal option id; a provider must never see it. Stored selections that
  // lost their profile id still carry it inside the composite, so recover it
  // here instead of falling through to the gateway, and refuse outright when
  // the composite cannot be parsed.
  const parsedSelection = parseModelOptionSelection(selection.id);
  if (parsedSelection.modelId.startsWith(USER_INFERENCE_OPTION_PREFIX)) {
    throw new InferenceProfileResolutionError(
      "This saved model selection is malformed and cannot be routed to a provider. Pick the model again in Settings -> Models.",
    );
  }

  const inferenceProfileId =
    params.inferenceProfileId || parsedSelection.inferenceProfileId;
  const resolvedSelection: AgentModelSelection =
    parsedSelection.modelId === selection.id
      ? selection
      : { ...selection, id: parsedSelection.modelId as typeof selection.id };

  if (!inferenceProfileId) {
    return {
      ...resolvedSelection,
      attribution: {
        inferenceRoute: "gateway",
        provider: resolvedSelection.id.split("/")[0],
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
    profile.provider === "anthropic" &&
    resolvedSelection.id.startsWith("anthropic/")
      ? toAnthropicDirectModelId(resolvedSelection.id)
      : resolvedSelection.id;
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
    ...resolvedSelection,
    directInference,
    attribution: {
      inferenceRoute: "user",
      inferenceProfileId: profile.id,
      inferenceProfileName: profile.name,
      provider: profile.provider,
    },
  };
}
