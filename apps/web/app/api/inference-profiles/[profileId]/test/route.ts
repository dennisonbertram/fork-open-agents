import {
  directAnthropicModel,
  directOpenAIModel,
  toAnthropicDirectModelId,
} from "@open-agents/agent";
import { generateText } from "ai";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
  INFERENCE_PROFILE_REENTER_KEY_MESSAGE,
  recordInferenceProfileTestResult,
  setInferenceProfileModels,
} from "@/lib/db/inference-profiles";
import { fetchInferenceProfileModels } from "@/lib/inference/fetch-profile-models";
import {
  normalizeInferenceProfileBaseUrl,
  toInferenceProfileTestMessage,
} from "@/lib/inference/model-routing";
import type { InferenceProfileModel } from "@/lib/inference/types";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

type TestProfileRequest = {
  modelId?: string;
};

const DEFAULT_TEST_MODEL_ID = "anthropic/claude-haiku-4.5";
const DEFAULT_OPENAI_COMPATIBLE_TEST_MODEL_ID = "gpt-4o-mini";
const FIREWORKS_ANTHROPIC_TEST_MODEL: InferenceProfileModel = {
  id: "accounts/fireworks/models/glm-5p2",
  displayName: "GLM 5.2",
  contextWindow: 1_048_576,
};

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function isFireworksBaseUrl(baseUrl: string | null): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    return new URL(baseUrl).hostname === "api.fireworks.ai";
  } catch {
    return false;
  }
}

function isAnthropicBaseUrl(baseUrl: string | null): boolean {
  if (!baseUrl) {
    return true;
  }

  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

function fallbackTestModel(
  provider: "anthropic" | "openai-compatible",
  baseUrl: string | null,
): InferenceProfileModel | null {
  if (provider === "openai-compatible") {
    return {
      id: DEFAULT_OPENAI_COMPATIBLE_TEST_MODEL_ID,
      displayName: DEFAULT_OPENAI_COMPATIBLE_TEST_MODEL_ID,
    };
  }

  if (isFireworksBaseUrl(baseUrl)) {
    return FIREWORKS_ANTHROPIC_TEST_MODEL;
  }

  return isAnthropicBaseUrl(baseUrl)
    ? { id: DEFAULT_TEST_MODEL_ID, displayName: DEFAULT_TEST_MODEL_ID }
    : null;
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { profileId } = await context.params;
  const profile = await getInferenceProfileByIdForUser(
    authResult.userId,
    profileId,
  );
  if (!profile) {
    return jsonError("Inference profile not found", 404);
  }

  let body: TestProfileRequest = {};
  try {
    body = (await req.json()) as TestProfileRequest;
  } catch {
    body = {};
  }

  let apiKey: string;
  try {
    apiKey = decryptInferenceProfileApiKey(profile);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "InferenceProfileResolutionError"
    ) {
      const updatedProfile = await recordInferenceProfileTestResult(
        authResult.userId,
        profile.id,
        {
          status: "failed",
          message: INFERENCE_PROFILE_REENTER_KEY_MESSAGE,
        },
      );

      return Response.json({
        profile: updatedProfile,
        result: {
          status: "failed",
          message: INFERENCE_PROFILE_REENTER_KEY_MESSAGE,
        },
      });
    }

    throw error;
  }

  try {
    const baseUrl = normalizeInferenceProfileBaseUrl(
      profile.provider,
      profile.baseUrl,
    );
    const fetchedModels = await fetchInferenceProfileModels({
      provider: profile.provider,
      baseUrl,
      apiKey,
    });
    const storedModels = profile.models ?? [];
    const fallbackModel = fallbackTestModel(profile.provider, baseUrl);
    const modelId =
      typeof body.modelId === "string" && body.modelId.trim().length > 0
        ? body.modelId.trim()
        : (fetchedModels[0]?.id ?? storedModels[0]?.id ?? fallbackModel?.id);
    if (!modelId) {
      return jsonError(
        "Could not discover a model from this inference profile. Add a model for the profile or choose a model before testing.",
        400,
      );
    }
    const directModelId =
      profile.provider === "anthropic" && modelId.startsWith("anthropic/")
        ? toAnthropicDirectModelId(modelId)
        : modelId;
    if (!directModelId) {
      return jsonError(
        profile.provider === "anthropic"
          ? "Inference profile test requires a model served by this Anthropic-compatible endpoint"
          : "Inference profile test requires a model served by this OpenAI-compatible endpoint",
        400,
      );
    }
    let testModel: Parameters<typeof generateText>[0]["model"];
    if (profile.provider === "anthropic") {
      testModel = directAnthropicModel({
        provider: "anthropic",
        modelId: directModelId,
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
    } else {
      if (!baseUrl) {
        return jsonError(
          "OpenAI-compatible inference profile test requires a base URL",
          400,
        );
      }

      testModel = directOpenAIModel({
        provider: "openai-compatible",
        modelId: directModelId,
        apiKey,
        baseURL: baseUrl,
      });
    }

    await generateText({
      model: testModel,
      prompt: 'Reply with only "OK".',
      maxOutputTokens: 16,
    });

    const modelsToSave =
      fetchedModels.length > 0
        ? fetchedModels
        : storedModels.length === 0 && fallbackModel?.id === modelId
          ? [fallbackModel]
          : [];

    if (modelsToSave.length > 0) {
      await setInferenceProfileModels(
        authResult.userId,
        profile.id,
        modelsToSave,
      );
    }

    const passedMessage =
      modelsToSave.length > 0
        ? `Profile test passed. Discovered ${modelsToSave.length} model${
            modelsToSave.length === 1 ? "" : "s"
          }.`
        : "Profile test passed.";
    const updatedProfile = await recordInferenceProfileTestResult(
      authResult.userId,
      profile.id,
      {
        status: "passed",
        message: passedMessage,
      },
    );

    return Response.json({
      profile: updatedProfile,
      result: {
        status: "passed",
        message: passedMessage,
      },
    });
  } catch (error) {
    const message = toInferenceProfileTestMessage(
      error,
      apiKey,
      profile.provider,
    );
    const updatedProfile = await recordInferenceProfileTestResult(
      authResult.userId,
      profile.id,
      {
        status: "failed",
        message,
      },
    );

    return Response.json({
      profile: updatedProfile,
      result: {
        status: "failed",
        message,
      },
    });
  }
}
