import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface ExecCall {
  command: string;
  cwd: string;
  timeoutMs: number;
}

const execCalls: ExecCall[] = [];
const pendingSkillExecResolvers: Array<() => void> = [];
let blockSkillExec = false;
let activeSkillExecs = 0;
let maxActiveSkillExecs = 0;

const sandbox = {
  workingDirectory: "/workspace",
  exec: mock(async (command: string, cwd: string, timeoutMs: number) => {
    execCalls.push({ command, cwd, timeoutMs });

    if (command === 'printf %s "$HOME"') {
      return {
        success: true,
        exitCode: 0,
        stdout: "/root",
        stderr: "",
        truncated: false,
      };
    }

    if (blockSkillExec) {
      activeSkillExecs += 1;
      maxActiveSkillExecs = Math.max(maxActiveSkillExecs, activeSkillExecs);
      await new Promise<void>((resolve) => {
        pendingSkillExecResolvers.push(resolve);
      });
      activeSkillExecs -= 1;
    }

    return {
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    };
  }),
};

const installerModulePromise = import("./global-skill-installer");

describe("installGlobalSkills", () => {
  beforeEach(() => {
    execCalls.length = 0;
    pendingSkillExecResolvers.length = 0;
    blockSkillExec = false;
    activeSkillExecs = 0;
    maxActiveSkillExecs = 0;
    sandbox.exec.mockClear();
  });

  test("installs each requested global skill", async () => {
    const { installGlobalSkills } = await installerModulePromise;

    await installGlobalSkills({
      sandbox: sandbox as never,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "ai-sdk" },
        { source: "vercel/workflow", skillName: "workflow" },
      ],
    });

    expect(execCalls).toEqual([
      {
        command: 'printf %s "$HOME"',
        cwd: "/workspace",
        timeoutMs: 5_000,
      },
      {
        command:
          "HOME='/root' $(command -v bunx || command -v npx) skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
      {
        command:
          "HOME='/root' $(command -v bunx || command -v npx) skills add 'vercel/workflow' --skill 'workflow' --agent amp -g -y --copy",
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
    ]);
  });

  test("does nothing when the skill list is empty", async () => {
    const { installGlobalSkills } = await installerModulePromise;

    await installGlobalSkills({
      sandbox: sandbox as never,
      globalSkillRefs: [],
    });

    expect(execCalls).toEqual([]);
  });

  test("installs multiple global skills concurrently", async () => {
    const { installGlobalSkills } = await installerModulePromise;

    blockSkillExec = true;
    const installPromise = installGlobalSkills({
      sandbox: sandbox as never,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "ai-sdk" },
        { source: "vercel/workflow", skillName: "workflow" },
      ],
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(pendingSkillExecResolvers).toHaveLength(2);
    expect(maxActiveSkillExecs).toBe(2);

    for (const resolve of pendingSkillExecResolvers) {
      resolve();
    }

    await installPromise;
  });
});
