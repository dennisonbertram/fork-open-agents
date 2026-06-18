import { describe, expect, mock, test } from "bun:test";
import * as path from "node:path";
import { discoverSkills } from "./discovery";
import { LocalSandbox } from "./test-support/local-sandbox";
import type { SkillMetadata } from "./types";

/**
 * Proof of concept: a standard-format, *code-bearing* skill discovered, loaded,
 * and executed end-to-end against the real skills runtime.
 *
 * The skill bundle lives under __fixtures__/code-bearing/skills/csv-stats and
 * contains a SKILL.md, a runnable script (scripts/summarize.ts), and a level-3
 * reference (references/heuristics.md). We drive the real `discoverSkills` and
 * the real `skillTool`, then run the bundled script through the sandbox `exec`
 * the agent's bash tool would use. The only thing swapped for the cloud Vercel
 * sandbox is a filesystem-backed implementation of the identical interface.
 */

const FIXTURES = path.join(import.meta.dir, "__fixtures__", "code-bearing");
const SKILLS_DIR = path.join(FIXTURES, "skills");
const SKILL_DIR = path.join(SKILLS_DIR, "csv-stats");
const CSV_PATH = path.join(FIXTURES, "data", "sample.csv");

const sandbox = new LocalSandbox(FIXTURES);

// The skill tool resolves its sandbox via connectSandbox(); point it at the
// filesystem-backed sandbox (same pattern as tools/utils.test.ts).
mock.module("@open-agents/sandbox", () => ({
  connectSandbox: () => Promise.resolve(sandbox),
}));

const { skillTool } = await import("../tools/skill");

type SkillExecute = (
  input: { skill: string; args?: string },
  options: { experimental_context?: unknown },
) => Promise<
  | { success: true; skillName: string; skillPath: string; content: string }
  | { success: false; error: string }
>;
const skillExecute = (skillTool as unknown as { execute: SkillExecute })
  .execute;

function buildContext(skills: SkillMetadata[]) {
  // Shape must satisfy isAgentContext(): both `sandbox` and `model` present.
  return {
    sandbox: { state: { type: "cloud" }, workingDirectory: FIXTURES },
    model: "test-model",
    skills,
  };
}

describe("code-bearing skill (POC)", () => {
  test("level 1: discovery surfaces standard frontmatter metadata", async () => {
    const skills = await discoverSkills(sandbox, [SKILLS_DIR]);
    const csvStats = skills.find((s) => s.name === "csv-stats");

    expect(csvStats).toBeDefined();
    expect(csvStats?.description).toContain("Summarize a CSV");
    expect(csvStats?.filename).toBe("SKILL.md");
    expect(csvStats?.path).toBe(SKILL_DIR);
    // `allowed-tools` is parsed from frontmatter (enforcement is a separate gap).
    expect(csvStats?.options.allowedTools).toEqual(["bash", "read"]);
  });

  test("level 2: skill tool loads body with directory injected + args substituted", async () => {
    const skills = await discoverSkills(sandbox, [SKILLS_DIR]);

    const result = await skillExecute(
      { skill: "csv-stats", args: CSV_PATH },
      { experimental_context: buildContext(skills) },
    );

    if (result.success !== true) {
      throw new Error(`skill load failed: ${result.error}`);
    }

    // Skill directory is injected so the model can locate bundled scripts.
    expect(result.content.startsWith(`Skill directory: ${SKILL_DIR}`)).toBe(
      true,
    );
    // Frontmatter is stripped from the loaded body.
    expect(result.content).not.toContain("description:");
    // $ARGUMENTS is replaced with the real path the model will pass to bash.
    expect(result.content).toContain(CSV_PATH);
    expect(result.content).not.toContain("$ARGUMENTS");
  });

  test("level 3: the bundled reference resource exists in the skill dir", async () => {
    // Not loaded into context until the model reads it — but it ships in the bundle.
    await expect(
      sandbox.access(path.join(SKILL_DIR, "references", "heuristics.md")),
    ).resolves.toBeUndefined();
  });

  test("execution: the bundled script runs and returns real computed output", async () => {
    const scriptPath = path.join(SKILL_DIR, "scripts", "summarize.ts");
    // Mirrors what the model would run via the bash tool after loading the skill.
    const command = `${process.execPath} ${JSON.stringify(scriptPath)} ${JSON.stringify(CSV_PATH)}`;

    const result = await sandbox.exec(command, FIXTURES, 30_000);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual({
      rows: 3,
      columns: {
        age: { mean: 40, min: 30, max: 50 },
        score: { mean: 90, min: 80, max: 100 },
      },
    });
  });
});
