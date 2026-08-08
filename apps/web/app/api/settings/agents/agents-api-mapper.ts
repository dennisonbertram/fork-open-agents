/**
 * Pure form→payload mapper + validator for the /api/settings/agents route.
 *
 * No I/O — only Zod schemas and data transformations.
 * Exported so unit tests can import without the route layer.
 */

import { z } from "zod";
import { splitModelSelection } from "@/lib/inference/model-option-id";

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
 * Splits a validated PATCH body's `modelId` into its bare model id and
 * inference profile id, so an internal "user-profile:<profileId>:<modelId>"
 * composite never reaches storage while its `inferenceProfileId` column stays
 * null (#1157). The Settings -> Agents "User model" picker emits exactly this
 * composite (`buildModelOptions`), so this is the write-boundary counterpart
 * to `resolve-agent.ts`'s read-side parsing.
 *
 * Also drops `role`: the input is a full validated PATCH body (`role` +
 * fields to change), but the result is a DB patch object — `upsertUserDefaultAgent`
 * already takes `role` as its own positional argument, and `UserDefaultAgentPatch`
 * has no `role` field. Keeping it in the result would silently pass an extra
 * `role` key through to the DB layer on every PATCH.
 *
 * `modelId` is only present in the result when it was present in `input` —
 * omitted stays omitted so a patch that doesn't touch the model field doesn't
 * accidentally reset it (see `UserDefaultAgentPatch`'s `?? null` defaults).
 */
export function splitAgentPatchModel(input: AgentPatchInput): Omit<
  AgentPatchInput,
  "modelId" | "role"
> & {
  modelId?: string | null;
  inferenceProfileId?: string | null;
} {
  const { modelId, role: _role, ...rest } = input;
  if (modelId === undefined) {
    return rest;
  }
  if (modelId === null) {
    return { ...rest, modelId: null, inferenceProfileId: null };
  }
  const split = splitModelSelection(modelId, null);
  return {
    ...rest,
    modelId: split.modelId,
    inferenceProfileId: split.inferenceProfileId,
  };
}

/**
 * Schema for validating a DELETE body to /api/settings/agents.
 */
export const agentDeleteSchema = z.object({
  role: agentRoleSchema,
});

export type AgentDeleteInput = z.infer<typeof agentDeleteSchema>;
