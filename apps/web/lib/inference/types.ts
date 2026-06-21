import { z } from "zod";

export const INFERENCE_PROFILE_PROVIDERS = [
  "anthropic",
  "openai-compatible",
] as const;
export const INFERENCE_PROFILE_STATUSES = [
  "untested",
  "verified",
  "failed",
] as const;
export const INFERENCE_ROUTES = ["gateway", "user"] as const;

export type InferenceProfileProvider =
  (typeof INFERENCE_PROFILE_PROVIDERS)[number];
export type InferenceProfileStatus =
  (typeof INFERENCE_PROFILE_STATUSES)[number];
export type InferenceRoute = (typeof INFERENCE_ROUTES)[number];

export const INFERENCE_PROFILE_PROVIDER_LABELS = {
  anthropic: "Anthropic-compatible",
  "openai-compatible": "OpenAI-compatible",
} satisfies Record<InferenceProfileProvider, string>;

const profileNameSchema = z.string().trim().min(1).max(80);
const baseUrlInputSchema = z
  .union([z.string().trim().max(2048), z.null()])
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine(
    (value) => {
      if (value === null) {
        return true;
      }
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "Base URL must be a valid HTTP URL" },
  );

export const createInferenceProfileInputSchema = z.object({
  name: profileNameSchema,
  provider: z.enum(INFERENCE_PROFILE_PROVIDERS).default("anthropic"),
  baseUrl: baseUrlInputSchema,
  apiKey: z.string().trim().min(1).max(4096),
  enabled: z.boolean().default(true),
});

export const updateInferenceProfileInputSchema = z
  .object({
    profileId: z.string().trim().min(1),
    name: profileNameSchema.optional(),
    provider: z.enum(INFERENCE_PROFILE_PROVIDERS).optional(),
    baseUrl: baseUrlInputSchema,
    apiKey: z.string().trim().min(1).max(4096).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.provider !== undefined ||
      value.baseUrl !== undefined ||
      value.apiKey !== undefined ||
      value.enabled !== undefined,
    {
      message: "At least one profile update is required",
      path: ["profileId"],
    },
  );

export const deleteInferenceProfileInputSchema = z.object({
  profileId: z.string().trim().min(1),
});

/**
 * A model served by an inference profile's endpoint, as discovered from the
 * provider's own `/v1/models` listing. Stored per-profile so the picker shows
 * the endpoint's real models (e.g. ZAI's `glm-4.6`) instead of borrowing the
 * app's Anthropic catalog.
 */
export const inferenceProfileModelSchema = z.object({
  /** Raw model id sent to the endpoint, e.g. "glm-4.6". */
  id: z.string().trim().min(1).max(200),
  /** Human label for the picker, e.g. "GLM-4.6". */
  displayName: z.string().trim().min(1).max(200),
  /** Context window in tokens, when the provider reports it. */
  contextWindow: z.number().int().positive().optional(),
});

export type InferenceProfileModel = z.infer<typeof inferenceProfileModelSchema>;

export type CreateInferenceProfileInput = z.infer<
  typeof createInferenceProfileInputSchema
>;
export type UpdateInferenceProfileInput = z.infer<
  typeof updateInferenceProfileInputSchema
>;

export interface SafeInferenceProfile {
  id: string;
  name: string;
  provider: InferenceProfileProvider;
  baseUrl: string | null;
  keyLast4: string;
  keyFingerprint: string;
  status: InferenceProfileStatus;
  lastTestedAt: Date | null;
  lastTestMessage: string | null;
  enabled: boolean;
  /** Models discovered from the endpoint's /v1/models listing (empty = not yet discovered). */
  models: InferenceProfileModel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InferenceProfileTestResult {
  status: "passed" | "failed";
  message: string;
}
