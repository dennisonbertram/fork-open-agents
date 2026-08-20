import { describe, expect, test } from "bun:test";
import {
  isCommittedDotEnvTemplate,
  isDotEnvFilePath,
  isSensitiveDotEnvPath,
} from "./path-security";

// isDotEnvFilePath answers one narrow question — does this name look like a
// dotenv file — and nothing about whether it is safe. Safety is decided by
// isCommittedDotEnvTemplate, which asks git.
describe("isDotEnvFilePath", () => {
  test.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.example",
    ".env.example.local",
    "apps/web/.env.local",
    "/abs/path/.ENV",
  ])("%s is dotenv-shaped", (filePath) => {
    expect(isDotEnvFilePath(filePath)).toBe(true);
  });

  test.each(["lib/environment.ts", "docs/env-vars.md", "README.md"])(
    "%s is not",
    (filePath) => {
      expect(isDotEnvFilePath(filePath)).toBe(false);
    },
  );
});

function fakeSandbox(
  exec: (command: string) => {
    success: boolean;
    stdout: string;
  },
) {
  const calls: string[] = [];
  return {
    calls,
    sandbox: {
      workingDirectory: "/work",
      exec: (command: string) => {
        calls.push(command);
        return Promise.resolve({ ...exec(command), stderr: "", exitCode: 0 });
      },
    } as never,
  };
}

const clean = () => ({ success: true, stdout: "" });

describe("isCommittedDotEnvTemplate", () => {
  const base = { workingDirectory: "/work" };

  test("a tracked, unmodified template is confirmed", async () => {
    const { sandbox, calls } = fakeSandbox(clean);
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox,
        absolutePath: "/work/apps/web/.env.example",
      }),
    ).resolves.toBe(true);
    expect(calls[0]).toContain("git status --porcelain");
  });

  // The review finding this exists for: a suffix is not evidence. An
  // untracked or locally-populated template must stay gated.
  test("git reporting the path as untracked or modified is not confirmed", async () => {
    const { sandbox } = fakeSandbox(() => ({
      success: true,
      stdout: "?? apps/web/.env.example\n",
    }));
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox,
        absolutePath: "/work/apps/web/.env.example",
      }),
    ).resolves.toBe(false);
  });

  test("a real dotenv file is never a template, however clean git is", async () => {
    const { sandbox } = fakeSandbox(clean);
    for (const p of [
      "/work/.env",
      "/work/.env.local",
      "/work/.env.example.local",
    ]) {
      await expect(
        isCommittedDotEnvTemplate({ ...base, sandbox, absolutePath: p }),
      ).resolves.toBe(false);
    }
  });

  test("the last suffix decides, so nested template names still qualify", async () => {
    const { sandbox } = fakeSandbox(clean);
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox,
        absolutePath: "/work/.env.production.example",
      }),
    ).resolves.toBe(true);
  });

  // Fail closed: every way this can go wrong keeps the file gated.
  test("a failed git call is not confirmation", async () => {
    const { sandbox } = fakeSandbox(() => ({ success: false, stdout: "" }));
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox,
        absolutePath: "/work/.env.example",
      }),
    ).resolves.toBe(false);
  });

  test("a throwing exec is not confirmation", async () => {
    const sandbox = {
      workingDirectory: "/work",
      exec: () => Promise.reject(new Error("sandbox gone")),
    } as never;
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox,
        absolutePath: "/work/.env.example",
      }),
    ).resolves.toBe(false);
  });

  test("a sandbox with no exec is not confirmation", async () => {
    await expect(
      isCommittedDotEnvTemplate({
        ...base,
        sandbox: { workingDirectory: "/work" } as never,
        absolutePath: "/work/.env.example",
      }),
    ).resolves.toBe(false);
  });
});

describe("isSensitiveDotEnvPath", () => {
  test("a symlink pointing at a real dotenv file is sensitive", () => {
    expect(
      isSensitiveDotEnvPath({
        requestedPath: "apps/web/.env.example",
        absolutePath: "/work/apps/web/.env.example",
        realPath: "/work/apps/web/.env.local",
      }),
    ).toBe(true);
  });
});
