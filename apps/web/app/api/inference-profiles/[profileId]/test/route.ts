import {
  directAnthropicModel,
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

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

type TestProfileRequest = {
  modelId?: string;
};

const DEFAULT_TEST_MODEL_ID = "anthropic/claude-haiku-4.5";

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
      : DEFAULT_TEST_MODEL_ID;
  const directModelId = toAnthropicDirectModelId(catalogModelId);
  if (!directModelId) {
    return jsonError("Inference profile test requires an Anthropic model", 400);
  }

  const apiKey = decryptInferenceProfileApiKey(profile);

  try {
    await generateText({
      model: directAnthropicModel({
        provider: "anthropic",
        modelId: directModelId,
        apiKey,
        ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
      }),
      prompt: 'Reply with only "OK".',
      maxOutputTokens: 16,
    });

    const updatedProfile = await recordInferenceProfileTestResult(
      authResult.userId,
      profile.id,
      {
        status: "passed",
        message: "Anthropic profile test passed.",
      },
    );

    return Response.json({
      profile: updatedProfile,
      result: {
        status: "passed",
        message: "Anthropic profile test passed.",
      },
    });
  } catch (error) {
    const message = toInferenceProfileTestMessage(error, apiKey);
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
