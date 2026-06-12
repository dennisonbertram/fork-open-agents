/**
 * Agent Loops API — request validation schemas (M1-08)
 *
 * Zod schemas for API request bodies. Imported by route handlers.
 * Colocated in lib (not app/api) so tests can mock the entire lib module.
 */
import { z } from "zod";

// Note: Zod v4 record schema requires (keyType, valueType) — z.record(z.string(), z.unknown())
const recordSchema = z.record(z.string(), z.unknown());

export const createAgentLoopBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  definition: recordSchema,
  guardrails: recordSchema.nullable().optional(),
  permissions: recordSchema.optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
});

export const updateAgentLoopBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    definition: recordSchema.optional(),
    guardrails: recordSchema.nullable().optional(),
    permissions: recordSchema.optional(),
  })
  .strict();

export type CreateAgentLoopBody = z.infer<typeof createAgentLoopBodySchema>;
export type UpdateAgentLoopBody = z.infer<typeof updateAgentLoopBodySchema>;
