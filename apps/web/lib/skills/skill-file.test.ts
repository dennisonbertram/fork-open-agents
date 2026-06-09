import { describe, expect, test } from "bun:test";
import {
  extractSkillBody,
  frontmatterToOptions,
  parseSkillFrontmatter,
} from "@open-agents/agent";
import { serializeSkillFile } from "./skill-file";

// Protected path: an enabled user skill must serialize to a SKILL.md that the
// agent's real (single-line YAML) frontmatter parser can read back. These tests
// round-trip through the actual parser exported by @open-agents/agent.
describe("serializeSkillFile", () => {
  test("round-trips name/description through the real frontmatter parser", () => {
    const file = serializeSkillFile({
      name: "code-review",
      description:
        "Reviews a diff for bugs, security, and style: line by line.",
      body: "# Code review\n\nDo the thing.",
    });

    const parsed = parseSkillFrontmatter(file);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.name).toBe("code-review");
    expect(parsed.data.description).toBe(
      "Reviews a diff for bugs, security, and style: line by line.",
    );
  });

  test("preserves the markdown body after the frontmatter", () => {
    const body = "# Title\n\nStep 1\nStep 2";
    const file = serializeSkillFile({
      name: "x-skill",
      description: "Desc",
      body,
    });

    expect(extractSkillBody(file).trim()).toBe(body.trim());
  });

  test("serializes invocation options into kebab-case frontmatter keys", () => {
    const file = serializeSkillFile({
      name: "scoped",
      description: "Scoped skill",
      body: "Body",
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ["read_file", "bash"],
    });

    const parsed = parseSkillFrontmatter(file);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const options = frontmatterToOptions(parsed.data);
    expect(options.disableModelInvocation).toBe(true);
    expect(options.userInvocable).toBe(false);
    expect(options.allowedTools).toEqual(["read_file", "bash"]);
  });

  test("omits optional frontmatter keys when left at their defaults", () => {
    const file = serializeSkillFile({
      name: "plain",
      description: "Plain",
      body: "Body",
    });

    expect(file).not.toContain("disable-model-invocation");
    expect(file).not.toContain("user-invocable");
    expect(file).not.toContain("allowed-tools");
  });

  test("escapes embedded quotes in the description", () => {
    const file = serializeSkillFile({
      name: "quoter",
      description: 'Use the "fast" path',
      body: "Body",
    });

    const parsed = parseSkillFrontmatter(file);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.description).toBe('Use the "fast" path');
  });

  test("collapses a multi-line description to a single parseable line", () => {
    const file = serializeSkillFile({
      name: "multi",
      description: "Line one\nLine two",
      body: "Body",
    });

    const parsed = parseSkillFrontmatter(file);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.description).toBe("Line one Line two");
  });
});
