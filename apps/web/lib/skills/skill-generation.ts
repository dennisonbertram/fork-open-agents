import { z } from "zod";

/** Max characters of the user's free-text request fed into the model. */
export const SKILL_GENERATION_REQUEST_MAX_LENGTH = 4000;

/**
 * Structured shape the model returns for an AI-drafted skill. The values are
 * suggestions the user reviews and edits before saving — the name is
 * re-slugified and everything is re-validated by `createUserSkillInputSchema`
 * on save, so this schema is intentionally permissive.
 */
export const skillDraftSchema = z.object({
  name: z
    .string()
    .describe(
      "A short kebab-case skill name: lowercase letters, numbers, and single hyphens only (e.g. code-review). No spaces, 2-48 characters.",
    ),
  description: z
    .string()
    .describe(
      "One sentence (max ~160 characters) describing when an agent should use this skill. Plain text, no surrounding quotes.",
    ),
  body: z
    .string()
    .describe(
      "The full SKILL.md instruction body in Markdown: clear, imperative, step-by-step guidance the agent follows when the skill runs. Use real newlines. Do NOT include YAML frontmatter or a --- block.",
    ),
});

export type SkillDraft = z.infer<typeof skillDraftSchema>;

/**
 * Build the prompt that asks the model to draft a skill from a natural-language
 * request. Kept pure so the instruction contract is unit-tested independently
 * of the AI SDK.
 */
export function buildSkillGenerationPrompt(request: string): string {
  const trimmed = request.trim().slice(0, SKILL_GENERATION_REQUEST_MAX_LENGTH);

  return `You are helping a developer author an "agent skill" for an AI coding agent.

A skill is a reusable, named instruction the agent can invoke on demand. It is stored as a Markdown file with three parts:
- name: a kebab-case slug used to invoke it (lowercase letters, numbers, single hyphens; no spaces).
- description: a single sentence telling the agent when to use the skill.
- body: Markdown instructions the agent follows when the skill runs.

Write a high-quality first draft for the skill the user describes below. Requirements:
- Make the name a concise kebab-case slug derived from the purpose.
- Make the description one clear sentence about when to use the skill.
- Make the body actionable: imperative, step-by-step Markdown the agent can follow. Prefer a short intro, then numbered or bulleted steps, then any important caveats.
- Do NOT include YAML frontmatter or a --- block in the body; only the instruction content.
- Keep it focused and practical. Do not invent project-specific details that were not provided.

User's request:
${trimmed}`;
}
