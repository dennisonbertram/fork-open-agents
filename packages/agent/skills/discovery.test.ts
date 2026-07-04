import { describe, expect, test } from "bun:test";
import type { Dirent } from "fs";
import type { ExecResult, Sandbox, SandboxStats } from "@open-agents/sandbox";
import {
  buildSkillDiscoveryCommand,
  discoverSkills,
  parseSkillDiscoveryOutput,
} from "./discovery";

const SKILL_MD = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nBody for ${name}.\n`;

function marker(filePath: string): string {
  return `\n<<<OA_SKILL_FILE:${filePath}>>>\n`;
}

interface FakeSandboxCounters {
  exec: number;
  stat: number;
  readdir: number;
  access: number;
  readFile: number;
}

/**
 * Build a fake Sandbox for tests. `execImpl` controls what sandbox.exec()
 * returns/throws. `slowPathFs` supplies the fake filesystem used by the
 * sequential fallback (stat/readdir/access/readFile).
 */
function makeFakeSandbox(options: {
  execImpl: (command: string) => Promise<ExecResult>;
  slowPathFs?: {
    directories: Record<string, boolean>;
    dirents: Record<string, Dirent[]>;
    files: Record<string, string>;
  };
}): { sandbox: Sandbox; counters: FakeSandboxCounters } {
  const counters: FakeSandboxCounters = {
    exec: 0,
    stat: 0,
    readdir: 0,
    access: 0,
    readFile: 0,
  };

  const fs = options.slowPathFs ?? {
    directories: {},
    dirents: {},
    files: {},
  };

  const sandbox = {
    type: "cloud",
    workingDirectory: "/workspace",
    exec: async (command: string) => {
      counters.exec += 1;
      return options.execImpl(command);
    },
    stat: async (dirPath: string): Promise<SandboxStats> => {
      counters.stat += 1;
      const isDir = fs.directories[dirPath];
      if (!isDir) {
        throw new Error(`ENOENT: ${dirPath}`);
      }
      return {
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtimeMs: 0,
      };
    },
    readdir: async (dirPath: string) => {
      counters.readdir += 1;
      const entries = fs.dirents[dirPath];
      if (!entries) {
        throw new Error(`ENOENT: ${dirPath}`);
      }
      return entries;
    },
    access: async (filePath: string) => {
      counters.access += 1;
      if (!(filePath in fs.files)) {
        throw new Error(`ENOENT: ${filePath}`);
      }
    },
    readFile: async (filePath: string) => {
      counters.readFile += 1;
      const content = fs.files[filePath];
      if (content === undefined) {
        throw new Error(`ENOENT: ${filePath}`);
      }
      return content;
    },
  } as unknown as Sandbox;

  return { sandbox, counters };
}

function makeDirent(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  } as unknown as Dirent;
}

describe("buildSkillDiscoveryCommand", () => {
  test("checks SKILL.md before skill.md", () => {
    const command = buildSkillDiscoveryCommand(["/workspace/skills"]);
    const upperIndex = command.indexOf("SKILL.md");
    const lowerIndex = command.indexOf("skill.md");
    expect(upperIndex).toBeGreaterThan(-1);
    expect(lowerIndex).toBeGreaterThan(-1);
    expect(upperIndex).toBeLessThan(lowerIndex);
  });

  test("includes every directory, single-quoted", () => {
    const command = buildSkillDiscoveryCommand([
      "/workspace/skills",
      "/workspace/.agents/skills",
    ]);
    expect(command).toContain("'/workspace/skills'");
    expect(command).toContain("'/workspace/.agents/skills'");
  });

  test("guards against missing directories and unexpanded globs", () => {
    const command = buildSkillDiscoveryCommand(["/workspace/skills"]);
    expect(command).toContain('[ -d "$dir" ] || continue');
    expect(command).toContain('[ -d "$sub" ] || continue');
  });
});

describe("parseSkillDiscoveryOutput", () => {
  test("splits combined stdout on markers into skillDir/filename/content", () => {
    const stdout =
      marker("/workspace/skills/foo/SKILL.md") +
      SKILL_MD("foo", "Foo skill") +
      marker("/workspace/skills/bar/skill.md") +
      SKILL_MD("bar", "Bar skill");

    const files = parseSkillDiscoveryOutput(stdout);

    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      skillDir: "/workspace/skills/foo",
      filename: "SKILL.md",
    });
    expect(files[0]?.content).toContain("name: foo");
    expect(files[1]).toMatchObject({
      skillDir: "/workspace/skills/bar",
      filename: "skill.md",
    });
    expect(files[1]?.content).toContain("name: bar");
  });

  test("tolerates content shorter than 2048 bytes", () => {
    const stdout = `${marker("/workspace/skills/tiny/SKILL.md")}---\nname: tiny\ndescription: d\n---\n`;
    const files = parseSkillDiscoveryOutput(stdout);
    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("name: tiny");
  });

  test("tolerates \\r\\n frontmatter", () => {
    const stdout = `${marker("/workspace/skills/crlf/SKILL.md")}---\r\nname: crlf\r\ndescription: d\r\n---\r\nBody\r\n`;
    const files = parseSkillDiscoveryOutput(stdout);
    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("name: crlf");
  });

  test("returns empty array for empty stdout", () => {
    expect(parseSkillDiscoveryOutput("")).toHaveLength(0);
  });
});

describe("discoverSkills fast path", () => {
  test("uses exactly one exec call and zero fs calls for 3 skills across 2 dirs", async () => {
    const stdout =
      marker("/workspace/skills/foo/SKILL.md") +
      SKILL_MD("foo", "Foo skill") +
      marker("/workspace/skills/bar/skill.md") +
      SKILL_MD("bar", "Bar skill") +
      marker("/workspace/extra/baz/SKILL.md") +
      SKILL_MD("baz", "Baz skill");

    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => ({
        success: true,
        exitCode: 0,
        stdout,
        stderr: "",
        truncated: false,
      }),
    });

    const skills = await discoverSkills(sandbox, [
      "/workspace/skills",
      "/workspace/extra",
    ]);

    expect(counters.exec).toBe(1);
    expect(counters.stat).toBe(0);
    expect(counters.readdir).toBe(0);
    expect(counters.access).toBe(0);
    expect(counters.readFile).toBe(0);

    expect(skills).toHaveLength(3);
    expect(skills[0]).toEqual({
      name: "foo",
      description: "Foo skill",
      path: "/workspace/skills/foo",
      filename: "SKILL.md",
      options: {
        disableModelInvocation: undefined,
        userInvocable: undefined,
        allowedTools: undefined,
        context: undefined,
        agent: undefined,
      },
    });
    expect(skills[1]?.name).toBe("bar");
    expect(skills[1]?.filename).toBe("skill.md");
    expect(skills[2]?.name).toBe("baz");
  });

  test("dedupes by name first-wins across directories", async () => {
    const stdout =
      marker("/workspace/skills/foo/SKILL.md") +
      SKILL_MD("foo", "First foo") +
      marker("/workspace/extra/foo-dup/SKILL.md") +
      SKILL_MD("FOO", "Second foo, should be ignored");

    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => ({
        success: true,
        exitCode: 0,
        stdout,
        stderr: "",
        truncated: false,
      }),
    });

    const skills = await discoverSkills(sandbox, [
      "/workspace/skills",
      "/workspace/extra",
    ]);

    expect(counters.exec).toBe(1);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("First foo");
  });

  test("skips skills that shadow built-in commands", async () => {
    const stdout =
      marker("/workspace/skills/model/SKILL.md") +
      SKILL_MD("model", "Shadows built-in") +
      marker("/workspace/skills/real/SKILL.md") +
      SKILL_MD("real", "Real skill");

    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => ({
        success: true,
        exitCode: 0,
        stdout,
        stderr: "",
        truncated: false,
      }),
    });

    const skills = await discoverSkills(sandbox, ["/workspace/skills"]);

    expect(counters.exec).toBe(1);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("real");
  });
});

describe("discoverSkills fallback to sequential discovery", () => {
  const slowPathFs = {
    directories: { "/workspace/skills": true },
    dirents: {
      "/workspace/skills": [makeDirent("foo")],
    },
    files: {
      "/workspace/skills/foo/SKILL.md": SKILL_MD("foo", "Foo skill"),
    },
  };

  test("falls back when exec returns success=false", async () => {
    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => ({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "boom",
        truncated: false,
      }),
      slowPathFs,
    });

    const skills = await discoverSkills(sandbox, ["/workspace/skills"]);

    expect(counters.exec).toBe(1);
    expect(counters.stat).toBeGreaterThan(0);
    expect(counters.readdir).toBeGreaterThan(0);
    expect(counters.access).toBeGreaterThan(0);
    expect(counters.readFile).toBeGreaterThan(0);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("foo");
  });

  test("falls back when exec returns truncated=true", async () => {
    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => ({
        success: true,
        exitCode: 0,
        stdout: "partial output that got cut off",
        stderr: "",
        truncated: true,
      }),
      slowPathFs,
    });

    const skills = await discoverSkills(sandbox, ["/workspace/skills"]);

    expect(counters.exec).toBe(1);
    expect(counters.stat).toBeGreaterThan(0);
    expect(counters.readdir).toBeGreaterThan(0);
    expect(counters.access).toBeGreaterThan(0);
    expect(counters.readFile).toBeGreaterThan(0);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("foo");
  });

  test("falls back when exec throws", async () => {
    const { sandbox, counters } = makeFakeSandbox({
      execImpl: async () => {
        throw new Error("network round-trip failed");
      },
      slowPathFs,
    });

    const skills = await discoverSkills(sandbox, ["/workspace/skills"]);

    expect(counters.exec).toBe(1);
    expect(counters.stat).toBeGreaterThan(0);
    expect(counters.readdir).toBeGreaterThan(0);
    expect(counters.access).toBeGreaterThan(0);
    expect(counters.readFile).toBeGreaterThan(0);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("foo");
  });
});
