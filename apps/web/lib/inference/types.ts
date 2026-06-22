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

const profileNameSchema = z.string().trim().min(1).max(80);
const modelIdsInputSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(50)
  .optional()
  .transform((value) =>
    value
      ? Array.from(new Set(value.map((modelId) => modelId.trim()))).filter(
          Boolean,
        )
      : [],
  );
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

export const createInferenceProfileInputSchema = z
  .object({
    name: profileNameSchema,
    provider: z.enum(INFERENCE_PROFILE_PROVIDERS).default("anthropic"),
    baseUrl: baseUrlInputSchema,
    modelIds: modelIdsInputSchema,
    apiKey: z.string().trim().min(1).max(4096),
    enabled: z.boolean().default(true),
  })
  .refine(
    (value) =>
      value.provider === "anthropic" ||
      ((value.baseUrl?.length ?? 0) > 0 && value.modelIds.length > 0),
    {
      message:
        "OpenAI-compatible profiles require a base URL and at least one model ID",
      path: ["modelIds"],
    },
  );

export const updateInferenceProfileInputSchema = z
  .object({
    profileId: z.string().trim().min(1),
    name: profileNameSchema.optional(),
    provider: z.enum(INFERENCE_PROFILE_PROVIDERS).optional(),
    baseUrl: baseUrlInputSchema,
    modelIds: modelIdsInputSchema,
    apiKey: z.string().trim().min(1).max(4096).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.provider !== undefined ||
      value.baseUrl !== undefined ||
      value.modelIds !== undefined ||
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
  modelIds: string[];
  keyLast4: string;
  keyFingerprint: string;
  status: InferenceProfileStatus;
  lastTestedAt: Date | null;
  lastTestMessage: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InferenceProfileTestResult {
  status: "passed" | "failed";
  message: string;
}
