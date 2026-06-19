import { z } from "zod";

/**
 * Built-in slash commands a skill name must not shadow. Mirrors
 * `BUILTIN_COMMANDS` in `packages/agent/skills/discovery.ts`; a skill with one
 * of these names is silently skipped during discovery, so reject it up front.
 */
export const RESERVED_SKILL_NAMES = ["model", "resume", "new"] as const;

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const SKILL_BODY_MAX_LENGTH = 100_000;
export const SKILL_ALLOWED_TOOLS_MAX = 50;

/** kebab-case: lowercase alphanumeric segments joined by single hyphens. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const RESERVED_SKILL_NAME_SET = new Set<string>(RESERVED_SKILL_NAMES);

export const skillNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(
    SKILL_NAME_MAX_LENGTH,
    `Name must be ${SKILL_NAME_MAX_LENGTH} characters or fewer`,
  )
  .regex(
    SKILL_NAME_PATTERN,
    "Use lowercase letters, numbers, and single hyphens (e.g. code-review)",
  )
  .refine((name) => !RESERVED_SKILL_NAME_SET.has(name), {
    message: "That name is reserved. Pick a different one.",
  });

const skillDescriptionSchema = z
  .string()
  .trim()
  .min(1, "Description is required")
  .max(
    SKILL_DESCRIPTION_MAX_LENGTH,
    `Description must be ${SKILL_DESCRIPTION_MAX_LENGTH} characters or fewer`,
  );

const skillBodySchema = z
  .string()
  .trim()
  .min(1, "Instructions are required")
  .max(
    SKILL_BODY_MAX_LENGTH,
    `Instructions must be ${SKILL_BODY_MAX_LENGTH} characters or fewer`,
  );

const allowedToolsSchema = z
  .array(z.string().trim())
  .max(SKILL_ALLOWED_TOOLS_MAX, "Too many allowed tools")
  .transform((tools) => tools.map((tool) => tool.trim()).filter(Boolean))
  .default([]);

export const skillSourceSchema = z.enum(["manual", "generated"]);

export const createUserSkillInputSchema = z.object({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  body: skillBodySchema,
  enabled: z.boolean().default(true),
  disableModelInvocation: z.boolean().default(false),
  userInvocable: z.boolean().default(true),
  allowedTools: allowedToolsSchema,
  source: skillSourceSchema.default("manual"),
});

export const updateUserSkillInputSchema = z.object({
  id: z.string().min(1, "Skill id is required"),
  name: skillNameSchema.optional(),
  description: skillDescriptionSchema.optional(),
  body: skillBodySchema.optional(),
  enabled: z.boolean().optional(),
  disableModelInvocation: z.boolean().optional(),
  userInvocable: z.boolean().optional(),
  allowedTools: z
    .array(z.string().trim())
    .max(SKILL_ALLOWED_TOOLS_MAX, "Too many allowed tools")
    .transform((tools) => tools.map((tool) => tool.trim()).filter(Boolean))
    .optional(),
});

export const deleteUserSkillInputSchema = z.object({
  id: z.string().min(1, "Skill id is required"),
});

export type CreateUserSkillInput = z.infer<typeof createUserSkillInputSchema>;
export type UpdateUserSkillInput = z.infer<typeof updateUserSkillInputSchema>;
export type DeleteUserSkillInput = z.infer<typeof deleteUserSkillInputSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;

/**
 * Best-effort conversion of a human label into a valid kebab-case skill name.
 * Used by the editor UI to suggest a slug as the user types a display name.
 */
export function slugifySkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX_LENGTH)
    .replace(/-+$/g, "");
}
