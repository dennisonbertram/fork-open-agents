import "server-only";

import type { Sandbox } from "@open-agents/sandbox";
import {
  parseNameStatus,
  resolveBaseRef,
  unescapeGitPath,
} from "@/app/api/sessions/[sessionId]/diff/_lib/diff-utils";

const GIT_CHANGED_PATHS_PROBE_TIMEOUT_MS = 30_000;

/**
 * Lists every path this run has touched (tracked + untracked), for the
 * #1288 acceptance check that compares a run's actual diff against a
 * caller-declared allowed-file list.
 *
 * Deliberately lighter than `computeAndCacheDiff` (lib/diff/compute-diff.ts):
 * only paths are needed here, never diff content or per-file stats, so this
 * skips per-file diff/content fetching entirely — cheap enough to run once
 * at the end of every declared-file-list run. Reuses the same base-ref
 * resolution and name-status parsing `computeAndCacheDiff` already uses, so
 * the acceptance check and `get_diff_summary` never disagree about which
 * files a run touched.
 *
 * Returns null on any probe failure — the same "unknown, not a violation"
 * carve-out `probeGitFingerprint` uses, so a transient sandbox hiccup can
 * never itself report a diff violation.
 */
export async function probeChangedFilePaths(
  sandbox: Sandbox,
): Promise<string[] | null> {
  try {
    const cwd = sandbox.workingDirectory;
    const baseRef = await resolveBaseRef(sandbox, cwd);

    const untrackedResult = await sandbox.exec(
      "git ls-files --others --exclude-standard",
      cwd,
      GIT_CHANGED_PATHS_PROBE_TIMEOUT_MS,
    );
    if (!untrackedResult.success) {
      return null;
    }
    const untrackedPaths = untrackedResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(unescapeGitPath);

    if (baseRef === null) {
      // No commits yet — only untracked files exist to have "changed".
      return untrackedPaths;
    }

    let diffRef = baseRef;
    if (baseRef !== "HEAD") {
      const mergeBaseResult = await sandbox.exec(
        `git merge-base ${baseRef} HEAD`,
        cwd,
        10_000,
      );
      if (mergeBaseResult.success && mergeBaseResult.stdout.trim()) {
        diffRef = mergeBaseResult.stdout.trim();
      }
      // If merge-base fails, fall back to the original baseRef — same
      // graceful degradation computeAndCacheDiff uses.
    }

    const nameStatusResult = await sandbox.exec(
      `git diff ${diffRef} --name-status`,
      cwd,
      GIT_CHANGED_PATHS_PROBE_TIMEOUT_MS,
    );
    if (!nameStatusResult.success) {
      return null;
    }
    const trackedPaths = [...parseNameStatus(nameStatusResult.stdout).keys()];

    return [...new Set([...trackedPaths, ...untrackedPaths])];
  } catch {
    return null;
  }
}
