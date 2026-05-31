// A minimal stand-in for the sandbox `exec` seam from
// packages/sandbox/interface.ts:
//
//   exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>
//
// The whole handoff is expressible as a sequence of these calls. In this POC we
// shell out locally; in production the SAME command strings run inside the
// Vercel sandbox via VercelSandbox.exec (packages/sandbox/vercel/sandbox.ts).
import { spawnSync } from "node:child_process";

export interface ExecResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export function exec(
  command: string,
  cwd: string,
  _timeoutMs = 30_000,
): ExecResult {
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    success: r.status === 0,
    exitCode: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    truncated: false,
  };
}

export function run(command: string, cwd: string): string {
  const r = exec(command, cwd);
  if (!r.success) {
    throw new Error(
      `command failed (exit ${r.exitCode}): ${command}\n${r.stderr || r.stdout}`,
    );
  }
  return r.stdout;
}
