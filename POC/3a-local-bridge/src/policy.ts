/**
 * POC 3a — local-exec SECURITY POLICY.
 *
 * This is the heart of the POC: `local_exec` is remote-code-execution on a
 * developer's machine, requested by a cloud agent. The policy enforces, IN
 * ORDER, every scoping layer that must hold BEFORE an operator is even asked to
 * approve, and again at run time. A command that fails any layer is rejected
 * and NEVER runs — even if the operator approves it (defense in depth: approval
 * is necessary but not sufficient).
 *
 * Layers (all must pass):
 *   1. Shape       — argv array only; the bridge spawns with shell:false so no
 *                    shell metacharacter (`;` `|` `&` `$()` backticks `>` ...)
 *                    is ever interpreted. We still reject argv tokens that
 *                    contain them, to fail loud rather than pass an attacker's
 *                    literal to a program that may re-shell it.
 *   2. Command allow/deny — the executable (argv[0]) must be on the allowlist
 *                    and not on the denylist. Default-deny.
 *   3. Working-dir jail — the resolved cwd must stay inside the jail root.
 *                    `..` traversal, absolute paths, and symlink escapes are
 *                    rejected. Path arguments that resolve outside the jail are
 *                    rejected (blocks `cat /etc/passwd`, `cat ../../secret`).
 *   4. Env allowlist — only an explicit set of env vars is passed; everything
 *                    else (tokens, AWS creds, SSH agent) is stripped.
 *   5. Timeout     — every command is killed after a hard wall-clock limit.
 *
 * The policy is PURE and synchronous so it is trivially testable and auditable.
 * The runner (`exec.ts`) re-checks the jail at spawn time against the real
 * resolved path, so a TOCTOU symlink swap between approval and run is caught.
 */
import * as path from "node:path";
import * as fs from "node:fs";

export type ExecPolicyConfig = {
  /** Absolute, real (symlink-resolved) jail root. Nothing may escape it. */
  jailRoot: string;
  /** Allowed executables (argv[0] basename). Default-deny: empty => nothing. */
  allowedCommands: string[];
  /** Explicitly denied executables (takes precedence over allow). */
  deniedCommands: string[];
  /** Env var names passed through to the child. Everything else is stripped. */
  envAllowlist: string[];
  /** Hard timeout in ms. */
  timeoutMs: number;
  /** Max bytes of combined stdout/stderr returned to the cloud. */
  maxOutputBytes: number;
};

export const DEFAULT_POLICY: Omit<ExecPolicyConfig, "jailRoot"> = {
  allowedCommands: ["echo", "ls", "cat", "git", "node", "bun", "pwd", "touch"],
  deniedCommands: [
    "rm",
    "sudo",
    "ssh",
    "scp",
    "curl",
    "wget",
    "nc",
    "bash",
    "sh",
    "zsh",
    "env",
    "export",
    "dd",
    "mkfs",
    "shred",
    "kill",
    "chmod",
    "chown",
  ],
  envAllowlist: ["PATH", "HOME", "LANG", "LC_ALL", "TERM"],
  timeoutMs: 10_000,
  maxOutputBytes: 256 * 1024,
};

/** Shell metacharacters that must never appear inside an argv token. */
const SHELL_METACHARS = /[;&|`$()<>\n\r{}*?~!#]|\$\(|&&|\|\|/;

export type PolicyVerdict =
  | { allowed: true; resolvedCwd: string; env: Record<string, string> }
  | { allowed: false; layer: PolicyLayer; reason: string };

export type PolicyLayer =
  | "shape"
  | "command-allowlist"
  | "command-denylist"
  | "working-dir-jail"
  | "path-argument-jail";

/**
 * Resolve a child-relative path against the jail and assert it stays inside.
 * Uses realpath on the *existing prefix* to defeat symlink escapes.
 */
function resolveInsideJail(
  jailRoot: string,
  candidate: string,
): { ok: true; resolved: string } | { ok: false; reason: string } {
  // Absolute paths are never allowed — everything is jail-relative.
  if (path.isAbsolute(candidate)) {
    return { ok: false, reason: `absolute path not allowed: ${candidate}` };
  }
  const joined = path.resolve(jailRoot, candidate);

  // Walk up to the longest existing ancestor and realpath it; this catches a
  // symlink anywhere in the existing prefix pointing outside the jail.
  let existing = joined;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let realExisting: string;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    realExisting = existing;
  }
  const realJail = fs.existsSync(jailRoot)
    ? fs.realpathSync(jailRoot)
    : path.resolve(jailRoot);

  const withSep = realJail.endsWith(path.sep) ? realJail : realJail + path.sep;
  if (realExisting !== realJail && !realExisting.startsWith(withSep)) {
    return {
      ok: false,
      reason: `path escapes jail: ${candidate} -> ${realExisting} (jail ${realJail})`,
    };
  }
  // Also verify the fully-joined target (which may not exist yet) is nominally
  // inside the jail after normalization.
  const normJoined = path.resolve(realJail, candidate);
  if (normJoined !== realJail && !normJoined.startsWith(withSep)) {
    return { ok: false, reason: `path escapes jail after normalization: ${candidate}` };
  }
  return { ok: true, resolved: normJoined };
}

/**
 * Heuristic: treat an argv token as a path argument if it looks like one
 * (contains a slash, or is `..`, or starts with `.`/`/`). Such tokens are
 * jail-checked. This blocks `cat /etc/passwd` and `cat ../../secret` while
 * letting flags like `-la` and plain names like `file.txt` through (file.txt
 * still resolves inside the cwd, which is inside the jail).
 */
function looksLikePath(token: string): boolean {
  if (token.startsWith("-")) return false; // flag
  return (
    token.includes("/") ||
    token === ".." ||
    token.startsWith("..") ||
    path.isAbsolute(token)
  );
}

/**
 * Evaluate the full policy for a local_exec request. Pure: no spawning.
 */
export function evaluatePolicy(
  config: ExecPolicyConfig,
  input: { argv: string[]; cwd: string },
): PolicyVerdict {
  const { argv, cwd } = input;

  // Layer 1: shape — reject shell metacharacters anywhere in argv.
  for (const token of argv) {
    if (SHELL_METACHARS.test(token)) {
      return {
        allowed: false,
        layer: "shape",
        reason: `argv token contains shell metacharacters: ${JSON.stringify(token)}`,
      };
    }
  }
  const exe = argv[0];
  if (!exe) {
    return { allowed: false, layer: "shape", reason: "empty argv" };
  }
  // The executable itself must be a bare name (no path) — forces PATH lookup
  // of an allowlisted command, blocks `/abs/path/evil` and `./script`.
  if (exe.includes("/") || exe.includes(path.sep)) {
    return {
      allowed: false,
      layer: "shape",
      reason: `executable must be a bare command name, got: ${exe}`,
    };
  }
  const exeName = path.basename(exe);

  // Layer 2/3: command deny (precedence) then allow. Default-deny.
  if (config.deniedCommands.includes(exeName)) {
    return {
      allowed: false,
      layer: "command-denylist",
      reason: `command is denied by policy: ${exeName}`,
    };
  }
  if (!config.allowedCommands.includes(exeName)) {
    return {
      allowed: false,
      layer: "command-allowlist",
      reason: `command not on allowlist: ${exeName}`,
    };
  }

  // Layer 3: working-directory jail.
  const cwdCheck = resolveInsideJail(config.jailRoot, cwd || ".");
  if (!cwdCheck.ok) {
    return { allowed: false, layer: "working-dir-jail", reason: cwdCheck.reason };
  }

  // Layer 3b: every path-like argument must resolve inside the jail too.
  for (const token of argv.slice(1)) {
    if (!looksLikePath(token)) continue;
    // Path args are resolved relative to the requested cwd.
    const rel = path.isAbsolute(token)
      ? token
      : path.relative(config.jailRoot, path.resolve(cwdCheck.resolved, token));
    const argCheck = resolveInsideJail(config.jailRoot, rel);
    if (!argCheck.ok) {
      return {
        allowed: false,
        layer: "path-argument-jail",
        reason: `argument escapes jail: ${token} (${argCheck.reason})`,
      };
    }
  }

  // Layer 4: env allowlist.
  const env: Record<string, string> = {};
  for (const name of config.envAllowlist) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  return { allowed: true, resolvedCwd: cwdCheck.resolved, env };
}
