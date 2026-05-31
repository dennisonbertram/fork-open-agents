/**
 * POC 3a — diff applier.
 *
 * Applies a cloud-proposed unified diff / git patch to the local working tree
 * with three guarantees:
 *   1. Dry-run preview FIRST (`git apply --check --summary`) — the patch is
 *      validated and a summary produced before anything touches disk.
 *   2. Apply only after the preview succeeds AND the operator confirms.
 *   3. Clean rollback: a snapshot (`git stash create` style — here we record
 *      tracked + untracked state) is taken; if apply fails or is aborted the
 *      tree is restored to the exact pre-apply state.
 *
 * The patch is constrained to the jail: `git apply` runs with cwd = jail root,
 * and we reject patches whose target paths escape the jail (`../`, absolute).
 */
import { spawn } from "node:child_process";
import * as path from "node:path";

export type DiffPreview = {
  ok: boolean;
  summary: string;
  filesChanged: string[];
  reason?: string;
};

export type DiffApplyResult =
  | { status: "applied"; filesChanged: string[]; detail: string }
  | { status: "rejected"; reason: string; rolledBack: boolean; detail: string };

function git(
  args: string[],
  cwd: string,
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** Parse `git apply --summary` output into a list of touched paths. */
function parseChangedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/) || line.match(/^--- a\/(.+)$/);
    if (m && m[1] && m[1] !== "/dev/null") files.add(m[1]);
    const diffGit = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffGit && diffGit[2]) files.add(diffGit[2]);
  }
  return [...files];
}

/** Reject patches whose targets escape the jail. */
function patchTargetsEscapeJail(patch: string): string | null {
  for (const f of parseChangedFiles(patch)) {
    if (path.isAbsolute(f)) return `absolute path in patch: ${f}`;
    const norm = path.normalize(f);
    if (norm.startsWith("..") || norm.includes(`..${path.sep}`)) {
      return `path escapes jail in patch: ${f}`;
    }
  }
  return null;
}

/** Step 1: dry-run preview. Does NOT modify the tree. */
export async function previewDiff(
  jailRoot: string,
  patch: string,
): Promise<DiffPreview> {
  const escape = patchTargetsEscapeJail(patch);
  if (escape) {
    return { ok: false, summary: "", filesChanged: [], reason: escape };
  }
  const check = await git(["apply", "--check", "--3way"], jailRoot, patch);
  const filesChanged = parseChangedFiles(patch);
  if (check.code !== 0) {
    // Retry without 3way for repos without the blobs (still a real check).
    const plainCheck = await git(["apply", "--check"], jailRoot, patch);
    if (plainCheck.code !== 0) {
      return {
        ok: false,
        summary: "",
        filesChanged,
        reason: (plainCheck.stderr || check.stderr).trim() || "patch does not apply",
      };
    }
  }
  return {
    ok: true,
    summary: `patch applies cleanly; touches ${filesChanged.length} file(s): ${filesChanged.join(", ")}`,
    filesChanged,
  };
}

/**
 * Take a rollback snapshot: commit-ish of HEAD plus a stash of working changes
 * is overkill for the POC; instead we capture the full tree state via
 * `git stash create` semantics emulated by recording the diff against HEAD and
 * the set of untracked files. The simplest *robust* approach in a temp repo:
 * record `git stash create` object, or fall back to a tar of tracked files.
 *
 * For determinism we snapshot by creating a temporary commit object reference:
 * we record HEAD and a `git stash create` id; on rollback we hard-reset to the
 * snapshot. Untracked files added by a failed apply are removed via
 * `git clean` limited to the changed set.
 */
async function snapshot(jailRoot: string): Promise<{ head: string; stash: string | null }> {
  const head = (await git(["rev-parse", "HEAD"], jailRoot)).stdout.trim();
  const created = await git(["stash", "create", "bridge-snapshot"], jailRoot);
  const stash = created.code === 0 && created.stdout.trim() ? created.stdout.trim() : null;
  return { head, stash };
}

async function rollback(
  jailRoot: string,
  snap: { head: string; stash: string | null },
  filesChanged: string[],
): Promise<void> {
  // Discard tracked changes back to HEAD.
  await git(["checkout", "--force", snap.head, "--", "."], jailRoot);
  await git(["reset", "--hard", snap.head], jailRoot);
  // Restore the working changes we had before (if any).
  if (snap.stash) {
    await git(["stash", "apply", snap.stash], jailRoot);
  }
  // Remove any new untracked files the failed/aborted apply may have created.
  for (const f of filesChanged) {
    await git(["clean", "-fd", "--", f], jailRoot);
  }
}

/**
 * Step 2/3: apply after confirm, with rollback on any failure.
 * `confirm` is the operator gate — if false, nothing is applied.
 */
export async function applyDiff(
  jailRoot: string,
  patch: string,
  confirm: boolean,
): Promise<DiffApplyResult> {
  const preview = await previewDiff(jailRoot, patch);
  if (!preview.ok) {
    return {
      status: "rejected",
      reason: preview.reason ?? "patch does not apply",
      rolledBack: false, // nothing was touched
      detail: "rejected at dry-run preview; working tree never modified",
    };
  }
  if (!confirm) {
    return {
      status: "rejected",
      reason: "operator did not confirm",
      rolledBack: false,
      detail: "preview ok but apply not confirmed; working tree never modified",
    };
  }

  const snap = await snapshot(jailRoot);
  const applied = await git(["apply", "--index", "--3way"], jailRoot, patch);
  if (applied.code !== 0) {
    const plain = await git(["apply"], jailRoot, patch);
    if (plain.code !== 0) {
      await rollback(jailRoot, snap, preview.filesChanged);
      return {
        status: "rejected",
        reason: (plain.stderr || applied.stderr).trim() || "apply failed",
        rolledBack: true,
        detail: "apply failed after preview; tree rolled back to pre-apply state",
      };
    }
  }
  return {
    status: "applied",
    filesChanged: preview.filesChanged,
    detail: `applied ${preview.filesChanged.length} file(s)`,
  };
}
