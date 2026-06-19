import { describe, expect, test } from "bun:test";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import { getLoopTemplate, LOOP_TEMPLATES } from "./loop-templates";

describe("loop templates", () => {
  test("at least the documented starter templates are present", () => {
    const slugs = LOOP_TEMPLATES.map((t) => t.slug);
    expect(slugs).toContain("review-to-issues");
    expect(slugs).toContain("backlog-to-pr");
    expect(slugs).toContain("email-triage");
    expect(slugs).toContain("merge-when-green");
  });

  test("every template slug is unique", () => {
    const slugs = LOOP_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const template of LOOP_TEMPLATES) {
    test(`template "${template.slug}" is a valid loop definition`, () => {
      const result = validateLoopDefinition(template.definition);
      if (!result.ok) {
        throw new Error(
          `Template "${template.slug}" is invalid: ${JSON.stringify(result.errors, null, 2)}`,
        );
      }
      expect(result.ok).toBe(true);
    });

    test(`template "${template.slug}" has name, description, and trigger copy`, () => {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.suggestedTrigger.length).toBeGreaterThan(0);
    });
  }

  test("getLoopTemplate resolves a known slug and returns undefined otherwise", () => {
    expect(getLoopTemplate("review-to-issues")?.name).toBe("Review to issues");
    expect(getLoopTemplate("does-not-exist")).toBeUndefined();
  });
});
