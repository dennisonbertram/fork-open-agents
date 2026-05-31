import * as path from "node:path";
import type { RepoResolution, SessionRepo } from "./types";

/**
 * Path-aware tool routing.
 *
 * In the real app, tools (packages/agent/tools/read.ts, bash.ts, edit.ts)
 * resolve every path against a single `sandbox.workingDirectory` using
 * `resolveWorkspacePath` + `isPathWithinDirectory` (see
 * packages/agent/tools/path-security.ts). With multiple repos checked out into
 * distinct paths under /workspace, a single working directory is no longer
 * enough: a path must be mapped to the *specific* repo it lives in so git and
 * file operations run in the right repo context.
 *
 * This router is the multi-repo replacement for `resolveWorkspacePath`. Instead
 * of one root it is given N roots (the repo localPaths) and returns which repo
 * a path belongs to, or null if the path is outside every repo.
 */

/** Mirror of isPathWithinDirectory from packages/agent/tools/utils.ts. */
function isPathWithinDirectory(target: string, directory: string): boolean {
  const normalizedDir = path.resolve(directory);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget === normalizedDir) {
    return true;
  }
  const withSep = normalizedDir.endsWith(path.sep)
    ? normalizedDir
    : normalizedDir + path.sep;
  return normalizedTarget.startsWith(withSep);
}

export class PathRouter {
  // Sorted by descending localPath length so that nested checkouts (a repo
  // inside another repo's path) resolve to the most specific repo first.
  private readonly repos: SessionRepo[];

  constructor(repos: SessionRepo[]) {
    this.repos = [...repos].sort(
      (a, b) => b.localPath.length - a.localPath.length,
    );
  }

  /**
   * Resolve an absolute path to the repo that owns it.
   * Returns null when the path is outside every repo checkout.
   */
  resolve(absolutePath: string): RepoResolution | null {
    if (!path.isAbsolute(absolutePath)) {
      return null;
    }
    const normalized = path.resolve(absolutePath);
    for (const repo of this.repos) {
      if (isPathWithinDirectory(normalized, repo.localPath)) {
        const relativePath = path
          .relative(repo.localPath, normalized)
          .split(path.sep)
          .join("/");
        return { repo, relativePath, absolutePath: normalized };
      }
    }
    return null;
  }

  /**
   * Resolve a path that may be repo-relative-qualified, e.g. "api/src/x.ts"
   * where "api" is a repo's directory name, OR an absolute path. Used to model
   * how a tool turns an agent-supplied path into a concrete repo + abs path.
   */
  resolveQualified(
    inputPath: string,
    workspaceRoot: string,
  ): RepoResolution | null {
    const abs = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(workspaceRoot, inputPath);
    return this.resolve(abs);
  }

  /** All repos known to the router, in their original order. */
  list(): SessionRepo[] {
    return [...this.repos].sort((a, b) => a.orderIndex - b.orderIndex);
  }

  /** Look up a repo by its directory name (basename of localPath). */
  byDirName(name: string): SessionRepo | null {
    return this.list().find((r) => path.basename(r.localPath) === name) ?? null;
  }
}
