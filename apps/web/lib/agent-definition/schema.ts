import { globalSkillRefSchema } from "@/lib/skills/global-skill-refs";
import { z } from "zod";

export const agentDefinitionSources = [
  "resolved_agent",
  "background_agent",
  "loop_agent_step",
] as const;

export type AgentDefinitionSource = (typeof agentDefinitionSources)[number];

/**
 * Builds an unambiguous identity from a source kind and one or more source IDs.
 * Length-prefixing prevents delimiter ambiguity, including composite loop/node
 * identities whose individual IDs may themselves contain slashes or colons.
 */
export function makeSourceQualifiedDefinitionId(
  source: AgentDefinitionSource,
  ...sourceIds: string[]
): string {
  return [source, ...sourceIds]
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

const agentDefinitionIdentitySchema = z
  .object({
    source: z.enum(agentDefinitionSources),
    sourceIds: z.array(z.string().min(1)).min(1),
    sourceQualifiedId: z.string().min(1),
  })
  .strict()
  .superRefine((identity, context) => {
    const expected = makeSourceQualifiedDefinitionId(
      identity.source,
      ...identity.sourceIds,
    );
    if (identity.sourceQualifiedId !== expected) {
      context.addIssue({
        code: "custom",
        message: "Source-qualified identity does not match its source IDs",
        path: ["sourceQualifiedId"],
      });
    }
  });

const instructionsSchema = z
  .object({
    text: z.string().nullable(),
    usesSourceDefault: z.boolean(),
  })
  .strict()
  .superRefine((instructions, context) => {
    if (instructions.usesSourceDefault !== (instructions.text === null)) {
      context.addIssue({
        code: "custom",
        message: "Source-default instructions must have null text",
        path: ["usesSourceDefault"],
      });
    }
  });

const builtinToolPolicySchema = z
  .object({
    mode: z.enum(["source_default", "allowlist"]),
    names: z.array(z.string()),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "source_default" && policy.names.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Source-default built-in policy cannot declare tool names",
        path: ["names"],
      });
    }
  });

export const agentDefinitionPermissionsSchema = z
  .object({
    github: z
      .object({
        contents: z.enum(["read", "write"]).optional(),
        pullRequests: z.enum(["read", "write"]).optional(),
        issues: z.enum(["read", "write"]).optional(),
        deployments: z.literal("read").optional(),
        statuses: z.literal("read").optional(),
        checks: z.literal("read").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Reusable execution definition only. Repository bindings, triggers,
 * schedules, enabled state, publishing policy, concurrency, credentials, and
 * workspace lifecycle deliberately live in adapter separation results.
 */
export const agentDefinitionV1Schema = z
  .object({
    version: z.literal(1),
    identity: agentDefinitionIdentitySchema,
    metadata: z
      .object({
        name: z.string().nullable(),
        description: z.string().nullable(),
      })
      .strict(),
    instructions: instructionsSchema,
    inference: z
      .object({
        modelId: z.string().nullable(),
        inferenceProfileId: z.string().nullable(),
      })
      .strict(),
    skills: z
      .object({
        refs: z.array(globalSkillRefSchema),
      })
      .strict(),
    tools: z
      .object({
        builtin: builtinToolPolicySchema,
        composio: z
          .object({
            toolkitSlugs: z.array(z.string()),
          })
          .strict(),
        nativeGithub: z
          .object({
            mode: z.enum(["source_default", "enabled", "disabled"]),
          })
          .strict(),
        authoring: z
          .object({
            enabled: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    permissions: agentDefinitionPermissionsSchema,
    runtime: z
      .object({
        managedRuntimeProfileId: z.string().nullable(),
      })
      .strict(),
    verification: z
      .object({
        checkCommand: z.string().nullable(),
      })
      .strict(),
    output: z
      .object({
        schema: z.record(z.string(), z.unknown()).nullable(),
      })
      .strict(),
  })
  .strict();

export type AgentDefinitionV1 = z.infer<typeof agentDefinitionV1Schema>;
export type AgentDefinitionPermissions = z.infer<
  typeof agentDefinitionPermissionsSchema
>;

export type AgentDefinitionParseResult =
  | { ok: true; definition: AgentDefinitionV1 }
  | { ok: false; error: { kind: "agent_definition_invalid" } };

/**
 * Safe validation boundary for callers. It deliberately returns one stable
 * kind and never reflects raw source configuration or validation input.
 */
export function parseAgentDefinition(
  input: unknown,
): AgentDefinitionParseResult {
  const parsed = agentDefinitionV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "agent_definition_invalid" },
    };
  }
  return { ok: true, definition: parsed.data };
}
