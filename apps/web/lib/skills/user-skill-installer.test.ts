import { describe, expect, test } from "bun:test";
import { parseSkillFrontmatter } from "@open-agents/agent";
import {
  installUserAuthoredSkills,
  type MaterializableSkill,
} from "./user-skill-installer";

function fakeSandbox() {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    sandbox: {
      writeFile: async (filePath: string, content: string, _enc: "utf-8") => {
        writes.push({ path: filePath, content });
      },
    },
  };
}

const enabled: MaterializableSkill = {
  name: "code-review",
  description: "Review code",
  body: "Body",
  enabled: true,
};
const disabled: MaterializableSkill = {
  name: "secret",
  description: "Nope",
  body: "Body",
  enabled: false,
};

describe("installUserAuthoredSkills", () => {
  test("writes only enabled skills to <globalDir>/<name>/SKILL.md", async () => {
    const { writes, sandbox } = fakeSandbox();

    const result = await installUserAuthoredSkills({
      sandbox,
      globalSkillsDirectory: "/root/.agents/skills",
      skills: [enabled, disabled],
    });

    expect(result.written).toEqual(["code-review"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/root/.agents/skills/code-review/SKILL.md");
  });

  test("writes content the real frontmatter parser can read", async () => {
    const { writes, sandbox } = fakeSandbox();

    await installUserAuthoredSkills({
      sandbox,
      globalSkillsDirectory: "/root/.agents/skills",
      skills: [enabled],
    });

    const parsed = parseSkillFrontmatter(writes[0]?.content ?? "");
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.name).toBe("code-review");
  });

  test("continues past a write failure and reports it", async () => {
    const failingSandbox = {
      writeFile: async (filePath: string) => {
        if (filePath.includes("breaks")) {
          throw new Error("disk full");
        }
      },
    };

    const result = await installUserAuthoredSkills({
      sandbox: failingSandbox,
      globalSkillsDirectory: "/root/.agents/skills",
      skills: [
        { name: "breaks", description: "d", body: "b", enabled: true },
        { name: "works", description: "d", body: "b", enabled: true },
      ],
    });

    expect(result.failed.map((f) => f.name)).toEqual(["breaks"]);
    expect(result.written).toEqual(["works"]);
  });

  test("returns no writes when there are no enabled skills", async () => {
    const { writes, sandbox } = fakeSandbox();

    const result = await installUserAuthoredSkills({
      sandbox,
      globalSkillsDirectory: "/root/.agents/skills",
      skills: [disabled],
    });

    expect(writes).toHaveLength(0);
    expect(result.written).toHaveLength(0);
  });
});
