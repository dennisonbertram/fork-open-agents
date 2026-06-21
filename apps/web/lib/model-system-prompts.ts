import { z } from "zod";
import { getModelOptionSelectionId } from "@/lib/inference/model-option-id";

export const MODEL_SYSTEM_PROMPT_MAX_LENGTH = 16_000;
const MODEL_SYSTEM_PROMPT_KEY_MAX_LENGTH = 500;

export function normalizeModelSystemPrompts(
  value: unknown,
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawPrompt] of Object.entries(value)) {
    if (typeof rawPrompt !== "string") {
      continue;
    }

    const key = rawKey.trim();
    const prompt = rawPrompt.trim();
    if (
      key.length === 0 ||
      key.length > MODEL_SYSTEM_PROMPT_KEY_MAX_LENGTH ||
      prompt.length === 0 ||
      prompt.length > MODEL_SYSTEM_PROMPT_MAX_LENGTH
    ) {
      continue;
    }

    normalized[key] = prompt;
  }

  return normalized;
}

export const modelSystemPromptsSchema = z
  .record(z.string(), z.string())
  .superRefine((prompts, ctx) => {
    for (const [rawKey, rawPrompt] of Object.entries(prompts)) {
      const key = rawKey.trim();
      const prompt = rawPrompt.trim();
      if (key.length === 0 || key.length > MODEL_SYSTEM_PROMPT_KEY_MAX_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: "Model system prompt keys must be non-empty model ids.",
          path: [rawKey],
        });
      }
      if (prompt.length > MODEL_SYSTEM_PROMPT_MAX_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: `Model system prompts must be ${MODEL_SYSTEM_PROMPT_MAX_LENGTH} characters or fewer.`,
          path: [rawKey],
        });
      }
    }
  })
  .transform((prompts) => normalizeModelSystemPrompts(prompts));

export type ModelSystemPrompts = z.infer<typeof modelSystemPromptsSchema>;

export function getModelSystemPromptForSelection(
  prompts: ModelSystemPrompts,
  params: {
    selectedModelId: string | null | undefined;
    resolvedModelId: string | null | undefined;
    inferenceProfileId: string | null | undefined;
  },
): string | null {
  const selectedKey = getModelOptionSelectionId(
    params.selectedModelId,
    params.inferenceProfileId,
  );
  const selectedPrompt = selectedKey ? prompts[selectedKey] : undefined;
  if (selectedPrompt) {
    return selectedPrompt;
  }

  if (!params.resolvedModelId) {
    return null;
  }

  return prompts[params.resolvedModelId] ?? null;
}
