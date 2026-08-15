import { describe, expect, mock, test } from "bun:test";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

const { probeChangedFilePaths } = await import("./git-changed-paths");

function ok(stdout: string): ExecResult {
  return { success: true, exitCode: 0, stdout, stderr: "", truncated: false };
}

function fail(): ExecResult {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: "fatal: error",
    truncated: false,
  };
}

/** A fake sandbox whose exec dispatches on a command-substring -> ExecResult map. */
function fakeSandbox(handlers: Record<string, ExecResult>): Sandbox {
  const exec = mock(async (command: string): Promise<ExecResult> => {
    for (const [needle, result] of Object.entries(handlers)) {
      if (command.includes(needle)) {
        return result;
      }
    }
    throw new Error(`unexpected command in test: ${command}`);
  });
  return { workingDirectory: "/vercel/sandbox", exec } as unknown as Sandbox;
}

describe("probeChangedFilePaths (#1288)", () => {
  test("lists tracked changed paths and untracked paths against a remote base ref", async () => {
    const sandbox = fakeSandbox({
      "symbolic-ref refs/remotes/origin/HEAD": ok("refs/remotes/origin/main\n"),
      "merge-base": ok("abc123\n"),
      "diff abc123 --name-status": ok("M\tsrc/a.ts\nA\tsrc/new.ts\n"),
      "ls-files --others --exclude-standard": ok("src/untracked.ts\n"),
    });

    const paths = await probeChangedFilePaths(sandbox);

    expect(paths).not.toBeNull();
    expect(new Set(paths)).toEqual(
      new Set(["src/a.ts", "src/new.ts", "src/untracked.ts"]),
    );
  });

  test("only untracked files count as changed in a repo with no commits", async () => {
    const sandbox = fakeSandbox({
      "symbolic-ref refs/remotes/origin/HEAD": fail(),
      "rev-parse HEAD": fail(),
      "ls-files --others --exclude-standard": ok("only-file.ts\n"),
    });

    const paths = await probeChangedFilePaths(sandbox);

    expect(paths).toEqual(["only-file.ts"]);
  });

  test("returns an empty list when nothing changed", async () => {
    const sandbox = fakeSandbox({
      "symbolic-ref refs/remotes/origin/HEAD": fail(),
      "rev-parse HEAD": ok("deadbeef\n"),
      "diff HEAD --name-status": ok(""),
      "ls-files --others --exclude-standard": ok(""),
    });

    const paths = await probeChangedFilePaths(sandbox);

    expect(paths).toEqual([]);
  });

  test("returns null when the diff command fails", async () => {
    const sandbox = fakeSandbox({
      "symbolic-ref refs/remotes/origin/HEAD": fail(),
      "rev-parse HEAD": ok("deadbeef\n"),
      "diff HEAD --name-status": fail(),
      "ls-files --others --exclude-standard": ok(""),
    });

    const paths = await probeChangedFilePaths(sandbox);

    expect(paths).toBeNull();
  });

  test("returns null when sandbox.exec throws", async () => {
    const exec = mock((): Promise<ExecResult> => {
      throw new Error("sandbox connection lost");
    });
    const sandbox = {
      workingDirectory: "/vercel/sandbox",
      exec,
    } as unknown as Sandbox;

    const paths = await probeChangedFilePaths(sandbox);

    expect(paths).toBeNull();
  });
});
