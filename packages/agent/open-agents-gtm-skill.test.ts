import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseSkillFrontmatter } from "./skills/discovery";

const repoRoot = join(import.meta.dir, "../..");
const claudeSkillPath = join(
  repoRoot,
  ".claude/skills/open-agents-gtm/SKILL.md",
);
const agentsSkillPath = join(
  repoRoot,
  ".agents/skills/open-agents-gtm/SKILL.md",
);
const routingMapPath = join(
  repoRoot,
  ".claude/skills/open-agents-gtm/references/gtm-epic-map.md",
);
const approvalBoundaryPath = join(
  repoRoot,
  ".claude/skills/open-agents-gtm/references/approval-boundaries.md",
);
const statusTemplatePath = join(
  repoRoot,
  ".claude/skills/open-agents-gtm/references/status-brief-template.md",
);
const promptFixturesPath = join(
  repoRoot,
  ".claude/skills/open-agents-gtm/examples/prompt-fixtures.md",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("open-agents-gtm repo skill", () => {
  test("has Claude and Open-Agents skill entrypoints with valid frontmatter", () => {
    expect(existsSync(claudeSkillPath)).toBe(true);
    expect(existsSync(agentsSkillPath)).toBe(true);

    for (const path of [claudeSkillPath, agentsSkillPath]) {
      const parsed = parseSkillFrontmatter(read(path));
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        continue;
      }
      expect(parsed.data.name).toBe("open-agents-gtm");
      expect(parsed.data.description).toContain("GTM");
    }
  });

  test("routes GTM jobs to the epic map, docs, APIs, and approval boundaries", () => {
    const claudeSkill = read(claudeSkillPath);
    const routingMap = read(routingMapPath);
    const approvalBoundary = read(approvalBoundaryPath);
    const statusTemplate = read(statusTemplatePath);

    for (const issue of [
      "#708",
      "#709",
      "#710",
      "#711",
      "#712",
      "#713",
      "#714",
      "#715",
    ]) {
      expect(routingMap).toContain(issue);
    }
    expect(claudeSkill).toContain("docs/process/gtm-operating-system.md");
    expect(claudeSkill).toContain("source-gap");
    expect(approvalBoundary).toContain("approval");
    expect(approvalBoundary).toContain("email");
    expect(approvalBoundary).toContain("CRM");
    expect(statusTemplate).toContain("Evidence Used");
    expect(statusTemplate).toContain("Source Gaps");
  });

  test("keeps the .agents adapter pointed at the canonical Claude skill", () => {
    const agentsSkill = read(agentsSkillPath);
    expect(agentsSkill).toContain(".claude/skills/open-agents-gtm/SKILL.md");
    expect(agentsSkill).toContain(
      ".claude/skills/open-agents-gtm/references/gtm-epic-map.md",
    );
    expect(agentsSkill).toContain("approval boundaries");
  });

  test("includes prompt fixtures for common GTM routes and unsafe mutations", () => {
    const fixtures = read(promptFixturesPath);
    for (const phrase of [
      "what should I do for GTM today",
      "turn these call notes into GTM follow-up",
      "send this outbound email",
      "weekly experiment review",
      "approval-required",
    ]) {
      expect(fixtures).toContain(phrase);
    }
  });
});
