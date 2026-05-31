// Minimal exec helper. Mirrors the sandbox `exec` seam from
// packages/sandbox/interface.ts; in production these same command strings run
// inside the Vercel sandbox via VercelSandbox.exec. Here we shell out locally.
import { spawnSync } from "node:child_process";

export function run(command: string, cwd: string): string {
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `command failed (exit ${r.status}): ${command}\n${r.stderr || r.stdout}`,
    );
  }
  return r.stdout ?? "";
}

export function tryRun(
  command: string,
  cwd: string,
): { ok: boolean; out: string } {
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
