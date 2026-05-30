import { z } from "zod";

const agentApiScopes = [
  "agent_runs:create",
  "agent_runs:read",
  "agent_runs:cancel",
] as const;

const repoNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+$/)
  .min(1);
const idempotencyKeySchema = z.string().trim().min(1).max(255);

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(agentApiScopes))
    .min(1)
    .default(["agent_runs:create", "agent_runs:read", "agent_runs:cancel"]),
  allowedRepositories: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    )
    .max(100)
    .nullable()
    .optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const agentRunCreateSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(64 * 1024),
  title: z.string().trim().min(1).max(160).optional(),
  repository: z
    .object({
      owner: repoNameSchema,
      name: repoNameSchema,
      branch: z.string().trim().min(1).max(255).optional(),
      cloneUrl: z.string().url().optional(),
      newBranch: z.boolean().optional(),
    })
    .optional(),
  runtimeMode: z
    .enum(["classic", "managed_runtime"])
    .default("managed_runtime"),
  managedRuntimeProfileId: z.string().trim().min(1).max(160).optional(),
  modelId: z.string().trim().min(1).max(200).optional(),
  autoCommitPush: z.boolean().optional(),
  autoCreatePr: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const listAgentRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      "accepted",
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled",
    ])
    .optional(),
});

export const listEventsQuerySchema = z.object({
  after: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const listMessagesQuerySchema = z.object({
  include: z.string().optional(),
});

export type CreateApiTokenBody = z.infer<typeof createApiTokenSchema>;
export type AgentRunCreateBody = z.infer<typeof agentRunCreateSchema>;
