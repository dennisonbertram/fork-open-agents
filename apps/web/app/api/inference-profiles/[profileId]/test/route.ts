import {
  directAnthropicModel,
  directOpenAICompatibleModel,
  toAnthropicDirectModelId,
} from "@open-agents/agent";
import { generateText } from "ai";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  decryptInferenceProfileApiKey,
  getInferenceProfileByIdForUser,
  recordInferenceProfileTestResult,
} from "@/lib/db/inference-profiles";
import { toInferenceProfileTestMessage } from "@/lib/inference/model-routing";
import {
  getInferenceProfileModelProvider,
  getInferenceProfileModelProviderDisplayName,
  toAnthropicCompatibleProfileModelId,
  toOpenAICompatibleProfileModelId,
} from "@/lib/inference/profile-models";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

type TestProfileRequest = {
  modelId?: string;
};

const DEFAULT_TEST_MODEL_ID = "anthropic/claude-haiku-4.5";
const DEFAULT_FIREWORKS_TEST_MODEL_ID = "fireworks/kimi-k2p5";

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
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

  const catalogModelId =
    typeof body.modelId === "string" && body.modelId.trim().length > 0
      ? body.modelId.trim()
      : profile.provider === "openai-compatible"
        ? (profile.modelIds?.[0] ?? "")
        : getInferenceProfileModelProvider(profile) === "fireworks"
          ? DEFAULT_FIREWORKS_TEST_MODEL_ID
          : DEFAULT_TEST_MODEL_ID;
  const directModelId =
    profile.provider === "openai-compatible"
      ? toOpenAICompatibleProfileModelId(profile, catalogModelId)
      : toAnthropicCompatibleProfileModelId(
          profile,
          catalogModelId,
          toAnthropicDirectModelId,
        );
  if (!directModelId) {
    const providerName = getInferenceProfileModelProviderDisplayName(profile);
    return jsonError(
      `Inference profile test requires a ${providerName} model`,
      400,
    );
  }
  const providerName = getInferenceProfileModelProviderDisplayName(profile);

  let apiKey: string;
  try {
    apiKey = decryptInferenceProfileApiKey(profile);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Saved API key could not be decrypted. Re-enter it in Settings → Models.";
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

  try {
    const model =
      profile.provider === "openai-compatible"
        ? directOpenAICompatibleModel({
            provider: "openai-compatible",
            name: profile.name,
            modelId: directModelId,
            apiKey,
            baseURL: profile.baseUrl ?? "",
          })
        : directAnthropicModel({
            provider: "anthropic",
            modelId: directModelId,
            apiKey,
            ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
          });

    await generateText({
      model,
      prompt: 'Reply with only "OK".',
      maxOutputTokens: 16,
    });

    const updatedProfile = await recordInferenceProfileTestResult(
      authResult.userId,
      profile.id,
      {
        status: "passed",
        message: `${providerName} profile test passed.`,
      },
    );

    return Response.json({
      profile: updatedProfile,
      result: {
        status: "passed",
        message: `${providerName} profile test passed.`,
      },
    });
  } catch (error) {
    const message = toInferenceProfileTestMessage(error, apiKey, providerName);
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
