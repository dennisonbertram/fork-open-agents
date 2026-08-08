import "server-only";

import { defaultModelLabel } from "@open-agents/agent";
import { getInferenceProfileByIdForUser } from "@/lib/db/inference-profiles";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  parseModelOptionSelection,
  USER_INFERENCE_OPTION_PREFIX,
} from "@/lib/inference/model-option-id";
import { normalizeInferenceProfileBaseUrl } from "@/lib/inference/model-routing";
import {
  backgroundAgentInferenceSnapshotV1Schema,
  type BackgroundAgentInferenceSnapshotV1,
} from "./execution-snapshot";

function normalizedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function resolveBackgroundAgentInferenceSnapshot(params: {
  userId: string;
  modelId: string | null | undefined;
  defaultModelId?: string;
}): Promise<BackgroundAgentInferenceSnapshotV1> {
  const selectionId =
    normalizedText(params.modelId) ??
    normalizedText(params.defaultModelId) ??
    defaultModelLabel;
  const parsed = parseModelOptionSelection(selectionId);

  if (!parsed.inferenceProfileId) {
    if (selectionId.startsWith(USER_INFERENCE_OPTION_PREFIX)) {
      throw new Error(
        "Selected inference profile is unavailable or malformed.",
      );
    }
    return backgroundAgentInferenceSnapshotV1Schema.parse({
      route: "gateway",
      modelId: parsed.modelId,
    });
  }

  const profile = await getInferenceProfileByIdForUser(
    params.userId,
    parsed.inferenceProfileId,
  );
  if (!profile) {
    throw new Error(
      "Selected inference profile is unavailable. Choose another User model or switch back to Vercel AI Gateway.",
    );
  }

  return backgroundAgentInferenceSnapshotV1Schema.parse({
    route: "user",
    modelId: parsed.modelId,
    inferenceProfileId: profile.id,
    provider: profile.provider,
    baseUrl: normalizeInferenceProfileBaseUrl(
      profile.provider,
      profile.baseUrl,
    ),
  });
}

/**
 * Resolves the user's `default_subagent_model_id` preference (#1158) into
 * the same frozen-snapshot shape as the main model, so it can be captured
 * with the run at creation time instead of read live at execution. Throws
 * on a broken preference (deleted/disabled profile) — callers decide
 * whether that's fatal; the existing convention for this field is
 * non-fatal (delegated workers fall back to inheriting the main model).
 */
export async function resolveBackgroundAgentSubagentInferenceSnapshot(
  userId: string,
): Promise<BackgroundAgentInferenceSnapshotV1 | undefined> {
  const preferences = await getUserPreferences(userId);
  if (!preferences.defaultSubagentModelId) {
    return undefined;
  }
  return resolveBackgroundAgentInferenceSnapshot({
    userId,
    modelId: preferences.defaultSubagentModelId,
  });
}
