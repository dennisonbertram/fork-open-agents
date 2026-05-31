/**
 * POC 3a — guarded command runner.
 *
 * Spawns an approved command with `shell: false` (argv form, no shell), inside
 * the jailed cwd, with a stripped env, a hard timeout, and a bounded output
 * buffer. Re-validates the policy at spawn time (TOCTOU defense) so a symlink
 * swap or policy change between approval and run cannot escape the jail.
 */
import { spawn } from "node:child_process";
import type { ExecPolicyConfig, PolicyVerdict } from "./policy";
import { evaluatePolicy } from "./policy";

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export type ExecOutcome =
  | { ok: true; result: ExecResult }
  | { ok: false; layer: string; reason: string };

/**
 * Run an approved command. Returns ok:false WITHOUT spawning if the (re-checked)
 * policy rejects it. This is the last line of defense: even an approved command
 * is re-validated here.
 */
export async function runGuarded(
  config: ExecPolicyConfig,
  input: { argv: string[]; cwd: string },
): Promise<ExecOutcome> {
  // Re-check at spawn time (defense in depth / TOCTOU).
  const verdict: PolicyVerdict = evaluatePolicy(config, input);
  if (!verdict.allowed) {
    return { ok: false, layer: verdict.layer, reason: verdict.reason };
  }

  const [exe, ...args] = input.argv;
  if (!exe) return { ok: false, layer: "shape", reason: "empty argv" };

  const startedAt = Date.now();
  return await new Promise<ExecOutcome>((resolve) => {
    const child = spawn(exe, args, {
      cwd: verdict.resolvedCwd,
      env: verdict.env, // stripped allowlist only
      shell: false, // CRITICAL: never interpret a shell
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killedForTimeout = false;
    let killedForOverflow = false;

    const cap = config.maxOutputBytes;
    const appendCapped = (buf: string, chunk: string): string => {
      if (buf.length >= cap) return buf;
      const next = buf + chunk;
      if (next.length > cap) {
        killedForOverflow = true;
        child.kill("SIGKILL");
        return next.slice(0, cap);
      }
      return next;
    };

    child.stdout.on("data", (d: Buffer) => {
      stdout = appendCapped(stdout, d.toString("utf8"));
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = appendCapped(stderr, d.toString("utf8"));
    });

    const timer = setTimeout(() => {
      killedForTimeout = true;
      child.kill("SIGKILL");
    }, config.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        layer: "spawn",
        reason: `failed to spawn ${exe}: ${err.message}`,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (killedForTimeout) {
        stderr += `\n[bridge] killed after ${config.timeoutMs}ms timeout`;
      }
      if (killedForOverflow) {
        stderr += `\n[bridge] output truncated at ${cap} bytes and killed`;
      }
      resolve({
        ok: true,
        result: {
          stdout,
          stderr,
          exitCode: code ?? (signal ? 137 : 1),
          durationMs,
        },
      });
    });
  });
}
