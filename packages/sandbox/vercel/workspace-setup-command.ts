/**
 * Pure builder for the one-shot workspace setup command run inside a freshly
 * created Vercel sandbox.
 *
 * Provisioning a sandbox used to issue several separate `runCommand` round-trips
 * (clone, then `git config`, then `git checkout -b`). Each round-trip is a
 * network call (~150ms), and the clone defaulted to full history. This module
 * collapses the whole setup into a single combined shell command and clones
 * shallowly by default — the agent only needs the working tree for inspection;
 * GitHub writes are brokered outside the sandbox.
 */

/** Default clone depth. Agents only inspect the working tree; full history is not needed. */
export const SHALLOW_CLONE_DEPTH = 1;

export interface WorkspaceCloneSpec {
  /** Repository URL to clone into the workspace. */
  url: string;
  /** Optional branch/revision to clone and check out. */
  branch?: string;
  /**
   * Clone depth. Defaults to {@link SHALLOW_CLONE_DEPTH} (shallow).
   * Pass `0` to perform a full-history clone.
   */
  depth?: number;
}

export interface WorkspaceSetupCommandParams {
  /** When set, clone this repository into the workspace. */
  clone?: WorkspaceCloneSpec;
  /** When true, initialize an empty git repository (no source). */
  initEmptyRepo?: boolean;
  /** Git identity to configure for commits, when available. */
  gitUser?: { name: string; email: string };
  /** When true, create an initial empty commit so HEAD exists (empty repos). */
  initialEmptyCommit?: boolean;
  /** When set, create and check out this new branch after setup. */
  newBranch?: string;
}

/** Single-quote a value for safe inclusion in a `bash -c` command string. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildCloneCommand(clone: WorkspaceCloneSpec): string {
  const depth = clone.depth ?? SHALLOW_CLONE_DEPTH;
  const parts = ["git", "clone"];
  if (depth > 0) {
    parts.push(`--depth=${depth}`, "--single-branch");
  }
  if (clone.branch) {
    parts.push("--branch", shellQuote(clone.branch));
  }
  parts.push(shellQuote(clone.url), ".");
  return parts.join(" ");
}

/**
 * Build the combined workspace setup command, or `undefined` when there is
 * nothing to do. Steps are joined with `&&` so any failure short-circuits and
 * surfaces a non-zero exit code.
 */
export function buildWorkspaceSetupCommand(
  params: WorkspaceSetupCommandParams,
): string | undefined {
  const steps: string[] = [];

  if (params.clone) {
    steps.push(buildCloneCommand(params.clone));
  }

  if (params.initEmptyRepo) {
    steps.push("git init");
  }

  if (params.gitUser) {
    steps.push(`git config user.name ${shellQuote(params.gitUser.name)}`);
    steps.push(`git config user.email ${shellQuote(params.gitUser.email)}`);
  }

  if (params.initialEmptyCommit) {
    steps.push("git commit --allow-empty -m 'Initial commit'");
  }

  if (params.newBranch) {
    steps.push(`git checkout -b ${shellQuote(params.newBranch)}`);
  }

  return steps.length > 0 ? steps.join(" && ") : undefined;
}
