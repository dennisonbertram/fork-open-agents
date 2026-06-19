import { describe, expect, test } from "bun:test";
import {
  buildSkillGenerationPrompt,
  SKILL_GENERATION_REQUEST_MAX_LENGTH,
  skillDraftSchema,
} from "./skill-generation";

describe("buildSkillGenerationPrompt", () => {
  test("embeds the user's request", () => {
    const prompt = buildSkillGenerationPrompt(
      "A skill that reviews React components for accessibility",
    );
    expect(prompt).toContain(
      "A skill that reviews React components for accessibility",
    );
  });

  test("instructs kebab-case name, a one-line description, and a frontmatter-free body", () => {
    const prompt = buildSkillGenerationPrompt("anything").toLowerCase();
    expect(prompt).toContain("kebab-case");
    expect(prompt).toContain("description");
    expect(prompt).toContain("frontmatter");
  });

  test("truncates an over-long request", () => {
    const huge = "x".repeat(SKILL_GENERATION_REQUEST_MAX_LENGTH + 500);
    const prompt = buildSkillGenerationPrompt(huge);
    const occurrences = prompt.split("x").length - 1;
    expect(occurrences).toBeLessThanOrEqual(
      SKILL_GENERATION_REQUEST_MAX_LENGTH,
    );
  });
});

describe("skillDraftSchema", () => {
  test("parses a well-formed draft", () => {
    const result = skillDraftSchema.safeParse({
      name: "a11y-review",
      description: "Reviews a React component for accessibility issues.",
      body: "# Accessibility review\n\nCheck for...",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a draft missing the body", () => {
    const result = skillDraftSchema.safeParse({
      name: "a11y-review",
      description: "desc",
    });
    expect(result.success).toBe(false);
  });
});
