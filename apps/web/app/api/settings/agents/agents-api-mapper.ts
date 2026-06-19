/**
 * Pure form→payload mapper + validator for the /api/settings/agents route.
 *
 * No I/O — only Zod schemas and data transformations.
 * Exported so unit tests can import without the route layer.
 */

import { z } from "zod";

const agentRoleSchema = z.enum(["main", "explorer", "executor", "design"]);

/**
 * Zod schema for validating a PATCH body to /api/settings/agents.
 * All fields except `role` are optional (null = reset to inherited).
 */
export const agentPatchSchema = z
  .object({
    role: agentRoleSchema,
    modelId: z.string().min(1).nullable().optional(),
    composioToolkitSlugs: z.array(z.string()).optional(),
    composioProfileId: z.string().min(1).nullable().optional(),
    instructions: z.string().nullable().optional(),
    managedRuntimeProfileId: z.string().min(1).nullable().optional(),
    githubToolsEnabled: z.boolean().optional(),
    /** Phase 6 (#242 / #388): enable the propose_composio_tool for this agent. Off by default. */
    toolAuthoringEnabled: z.boolean().optional(),
  })
  .strict();

export type AgentPatchInput = z.infer<typeof agentPatchSchema>;

/**
 * Schema for validating a DELETE body to /api/settings/agents.
 */
export const agentDeleteSchema = z.object({
  role: agentRoleSchema,
});

export type AgentDeleteInput = z.infer<typeof agentDeleteSchema>;
