import { spawnSync } from "node:child_process";

/**
 * Minimal git wrapper scoped to a working directory.
 *
 * In production these calls go through `sandbox.exec(command, cwd, timeout)`
 * (see packages/sandbox/interface.ts and how packages/agent/tools/bash.ts uses
 * it). The signature here (run(args, cwd)) is the same shape: a command plus an
 * explicit cwd. The coordinator always passes the *repo's* localPath as cwd, so
 * git operations are isolated per repo — exactly how the real exec routing
 * would work once cwd is repo-scoped instead of session-scoped.
 */
export type GitResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function git(args: string[], cwd: string): GitResult {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Open Agents POC",
      GIT_AUTHOR_EMAIL: "poc@open-agents.local",
      GIT_COMMITTER_NAME: "Open Agents POC",
      GIT_COMMITTER_EMAIL: "poc@open-agents.local",
    },
  });
  return {
    success: res.status === 0,
    exitCode: res.status ?? -1,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
  };
}

export function gitOrThrow(args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (!r.success) {
    throw new Error(
      `git ${args.join(" ")} (cwd=${cwd}) failed [${r.exitCode}]: ${r.stderr || r.stdout}`,
    );
  }
  return r.stdout;
}
