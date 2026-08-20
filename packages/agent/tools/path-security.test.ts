import { describe, expect, test } from "bun:test";
import { isDotEnvFilePath, isSensitiveDotEnvPath } from "./path-security";

describe("isDotEnvFilePath", () => {
  // A real dotenv file holds secrets. Reading one needs a human.
  test.each([
    ".env",
    ".env.local",
    ".env.production",
    "apps/web/.env.local",
    "/abs/path/.ENV",
  ])("%s is a secret-bearing dotenv file", (filePath) => {
    expect(isDotEnvFilePath(filePath)).toBe(true);
  });

  // These are committed to the repository on purpose and hold placeholders,
  // not secrets. Gating them stalled a headless run that could never be
  // approved, for a file the agent is meant to read.
  test.each([
    ".env.example",
    ".env.sample",
    ".env.template",
    ".env.dist",
    "apps/web/.env.example",
    ".env.production.example",
    "/abs/path/.ENV.EXAMPLE",
  ])("%s is a committed template, not a secret", (filePath) => {
    expect(isDotEnvFilePath(filePath)).toBe(false);
  });

  // The exemption reads the LAST suffix, so a real local file cannot hide
  // behind an example-looking segment earlier in the name.
  test.each([".env.example.local", ".env.sample.local", ".env.template.bak"])(
    "%s is still treated as secret-bearing",
    (filePath) => {
      expect(isDotEnvFilePath(filePath)).toBe(true);
    },
  );

  test("a file that merely mentions env is not a dotenv file", () => {
    expect(isDotEnvFilePath("lib/environment.ts")).toBe(false);
    expect(isDotEnvFilePath("docs/env-vars.md")).toBe(false);
  });
});

describe("isSensitiveDotEnvPath", () => {
  test("an example file is not sensitive by any of the three path forms", () => {
    expect(
      isSensitiveDotEnvPath({
        requestedPath: "apps/web/.env.example",
        absolutePath: "/work/apps/web/.env.example",
        realPath: "/work/apps/web/.env.example",
      }),
    ).toBe(false);
  });

  // Symlink escape: the requested name looks harmless, the real target is not.
  test("a symlink pointing at a real dotenv file is still sensitive", () => {
    expect(
      isSensitiveDotEnvPath({
        requestedPath: "apps/web/.env.example",
        absolutePath: "/work/apps/web/.env.example",
        realPath: "/work/apps/web/.env.local",
      }),
    ).toBe(true);
  });
});
