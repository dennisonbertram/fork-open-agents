// Multi-repo session model types.
//
// This POC generalizes the single-repo fields currently on the `sessions`
// table in apps/web/lib/db/schema.ts (repoOwner, repoName, branch, cloneUrl,
// prNumber, prStatus) into an N-repo model via a `session_repos` child table.

export type RepoRole = "primary" | "secondary";

/**
 * One row of the proposed `session_repos` table. A session references N of
 * these. The fields mirror the single-repo columns on `sessions` today:
 *   sessions.repoOwner  -> sessionRepos.repoOwner
 *   sessions.repoName   -> sessionRepos.repoName
 *   sessions.branch     -> sessionRepos.branch
 *   sessions.cloneUrl   -> sessionRepos.cloneUrl
 *   sessions.prNumber   -> sessionRepos.prNumber
 *   sessions.prStatus   -> sessionRepos.prStatus
 * plus multi-repo-only fields: localPath, role, orderIndex.
 */
export type SessionRepo = {
  sessionId: string;
  repoOwner: string;
  repoName: string;
  /** Branch to check out / create for this repo's slice of the change. */
  branch: string;
  /** Git clone URL (local path or remote https). */
  cloneUrl: string;
  /** Absolute checkout path inside the sandbox workspace, e.g. /workspace/api. */
  localPath: string;
  role: RepoRole;
  /** Stable ordering for display and deterministic PR-plan generation. */
  orderIndex: number;
};

/** Result of resolving an absolute path to a specific repo checkout. */
export type RepoResolution = {
  repo: SessionRepo;
  /** Path relative to the repo's localPath (forward slashes). */
  relativePath: string;
  /** The absolute, normalized path that was resolved. */
  absolutePath: string;
};

/** Per-repo working state tracked by the coordinator. */
export type RepoWorkingState = {
  repo: SessionRepo;
  cloned: boolean;
  currentBranch: string | null;
  /** Files (repo-relative) that have been edited via the coordinator. */
  dirtyFiles: Set<string>;
  /** Commit sha once this repo's change set is committed. */
  commitSha: string | null;
};

/** A planned (or created) pull request for a single repo. */
export type RepoPrPlan = {
  repoOwner: string;
  repoName: string;
  role: RepoRole;
  head: string; // feature branch
  base: string; // target branch (e.g. main)
  title: string;
  /** Filled in by the GitHub App after creation; null while planned. */
  prNumber: number | null;
  url: string | null;
  commitSha: string | null;
};

/** The coordinated, linked-PR plan across all repos in the session. */
export type LinkedPrPlan = {
  sessionId: string;
  /** A correlation id stitched into every PR body for cross-referencing. */
  changeSetId: string;
  prs: RepoPrPlan[];
  /**
   * Cross-reference text injected into each PR body. Keyed by repo full name;
   * value is the markdown block that references the *other* repos' PRs.
   */
  crossReferences: Record<string, string>;
};
