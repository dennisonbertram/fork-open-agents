/**
 * Agent Loops API — request validation schemas (M1-08)
 *
 * Zod schemas for API request bodies. Imported by route handlers.
 * Colocated in lib (not app/api) so tests can mock the entire lib module.
 */
import { z } from "zod";
import { loopGuardrailsSchema } from "./types";

// Note: Zod v4 record schema requires (keyType, valueType) — z.record(z.string(), z.unknown())
const recordSchema = z.record(z.string(), z.unknown());

// Strict guardrails schema for API request bodies. All numeric ceiling fields
// are validated as positive integers so strings like "never" are rejected at
// the API boundary before they can reach the executor's Math.min() paths.
// The object uses .strict() to reject unknown keys (no silent JSONB garbage).
// Individual fields are optional — missing fields fall back to GUARDRAIL_DEFAULTS.
const guardrailsBodySchema = loopGuardrailsSchema.nullable().optional();

export const createAgentLoopBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  definition: recordSchema,
  guardrails: guardrailsBodySchema,
  permissions: recordSchema.optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
});

export const updateAgentLoopBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    definition: recordSchema.optional(),
    guardrails: guardrailsBodySchema,
    permissions: recordSchema.optional(),
    // M3-01 watchdog fields
    watchdogEnabled: z.boolean().optional(),
    watchdogInstructions: z.string().nullable().optional(),
    watchdogRetryBudget: z.number().int().min(0).max(5).optional(),
  })
  .strict();

export type CreateAgentLoopBody = z.infer<typeof createAgentLoopBodySchema>;
export type UpdateAgentLoopBody = z.infer<typeof updateAgentLoopBodySchema>;
