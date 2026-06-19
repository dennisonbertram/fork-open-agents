import { describe, expect, test } from "bun:test";
import {
  createUserSkillInputSchema,
  RESERVED_SKILL_NAMES,
  skillNameSchema,
  slugifySkillName,
  updateUserSkillInputSchema,
} from "./skill-types";

describe("skillNameSchema", () => {
  test("accepts kebab-case slugs", () => {
    expect(skillNameSchema.safeParse("code-review").success).toBe(true);
    expect(skillNameSchema.safeParse("a1").success).toBe(true);
    expect(skillNameSchema.safeParse("pr-summary-2").success).toBe(true);
  });

  test("rejects spaces and uppercase", () => {
    expect(skillNameSchema.safeParse("Code Review").success).toBe(false);
    expect(skillNameSchema.safeParse("CodeReview").success).toBe(false);
    expect(skillNameSchema.safeParse("code review").success).toBe(false);
  });

  test("rejects reserved built-in command names", () => {
    for (const name of RESERVED_SKILL_NAMES) {
      expect(skillNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("rejects too-short names and leading/trailing hyphens", () => {
    expect(skillNameSchema.safeParse("a").success).toBe(false);
    expect(skillNameSchema.safeParse("-x").success).toBe(false);
    expect(skillNameSchema.safeParse("x-").success).toBe(false);
    expect(skillNameSchema.safeParse("a--b").success).toBe(false);
  });
});

describe("createUserSkillInputSchema", () => {
  test("requires a non-empty description and body", () => {
    const result = createUserSkillInputSchema.safeParse({
      name: "ok-skill",
      description: "",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  test("defaults invocation options and source when omitted", () => {
    const result = createUserSkillInputSchema.safeParse({
      name: "ok-skill",
      description: "Desc",
      body: "Body",
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.enabled).toBe(true);
    expect(result.data.disableModelInvocation).toBe(false);
    expect(result.data.userInvocable).toBe(true);
    expect(result.data.allowedTools).toEqual([]);
    expect(result.data.source).toBe("manual");
  });

  test("drops blank allowed-tool entries", () => {
    const result = createUserSkillInputSchema.safeParse({
      name: "ok-skill",
      description: "Desc",
      body: "Body",
      allowedTools: ["read_file", "  ", "bash"],
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.allowedTools).toEqual(["read_file", "bash"]);
  });
});

describe("updateUserSkillInputSchema", () => {
  test("requires an id and allows partial fields", () => {
    expect(
      updateUserSkillInputSchema.safeParse({ description: "x" }).success,
    ).toBe(false);
    expect(
      updateUserSkillInputSchema.safeParse({ id: "skill_1", enabled: false })
        .success,
    ).toBe(true);
  });
});

describe("slugifySkillName", () => {
  test("converts a human label to a kebab slug", () => {
    expect(slugifySkillName("Code Review!")).toBe("code-review");
    expect(slugifySkillName("  My  Skill  ")).toBe("my-skill");
    expect(slugifySkillName("PR → summary")).toBe("pr-summary");
  });
});
