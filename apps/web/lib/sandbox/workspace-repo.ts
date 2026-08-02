import type { Sandbox } from "@open-agents/sandbox";

const GIT_PROBE_TIMEOUT_MS = 10_000;

export interface WorkspaceRepoState {
  /** True when the working directory has an `origin` remote (i.e. a real clone). */
  cloned: boolean;
  /** Branch actually checked out in the sandbox, when it can be read. */
  branch?: string;
}

/**
 * Read what is actually checked out in a sandbox workspace.
 *
 * `POST /api/sandbox` must never report a branch it did not check out, and a
 * clone that never happened must surface as a failure instead of a 200. This
 * probe is the single source of truth for both the create and the
 * already-active paths.
 */
export async function readWorkspaceRepoState(
  sandbox: Pick<Sandbox, "exec" | "workingDirectory">,
): Promise<WorkspaceRepoState> {
  const cwd = sandbox.workingDirectory;

  const remote = await sandbox.exec(
    "git remote get-url origin",
    cwd,
    GIT_PROBE_TIMEOUT_MS,
  );
  if (!(remote.success && remote.stdout.trim())) {
    return { cloned: false };
  }

  const head = await sandbox.exec(
    "git rev-parse --abbrev-ref HEAD",
    cwd,
    GIT_PROBE_TIMEOUT_MS,
  );
  const branch = head.success ? head.stdout.trim() : "";

  return { cloned: true, ...(branch ? { branch } : {}) };
}
