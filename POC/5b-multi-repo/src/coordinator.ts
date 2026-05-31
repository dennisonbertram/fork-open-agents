import { promises as fs } from "node:fs";
import * as path from "node:path";
import { git, gitOrThrow } from "./git";
import { PathRouter } from "./path-router";
import type {
  LinkedPrPlan,
  RepoPrPlan,
  RepoWorkingState,
  SessionRepo,
} from "./types";

export type WriteResult =
  | { success: true; repo: string; relativePath: string; absolutePath: string }
  | { success: false; error: string };

export type CommitResult = {
  repo: string;
  branch: string;
  commitSha: string;
  files: string[];
};

/**
 * MultiRepoCoordinator
 *
 * Owns N repo checkouts for one session. Responsibilities:
 *  - clone each repo into a distinct path under the workspace root
 *  - create / track a per-repo feature branch
 *  - route file writes to the correct repo by absolute path (rejecting paths
 *    outside every repo) and record per-repo dirty files
 *  - commit each repo's slice in isolation (no cross-repo file contamination)
 *  - emit a coordinated, linked-PR plan whose PR bodies cross-reference
 *
 * This generalizes apps/web/app/workflows/chat-sandbox-runtime.ts, which today
 * clones a single `session.cloneUrl` at one branch into one
 * `sandbox.workingDirectory`.
 */
export class MultiRepoCoordinator {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly router: PathRouter;
  private readonly state: Map<string, RepoWorkingState> = new Map();

  constructor(params: {
    sessionId: string;
    workspaceRoot: string;
    repos: SessionRepo[];
  }) {
    this.sessionId = params.sessionId;
    this.workspaceRoot = params.workspaceRoot;
    this.router = new PathRouter(params.repos);
    for (const repo of params.repos) {
      this.state.set(repoKey(repo), {
        repo,
        cloned: false,
        currentBranch: null,
        dirtyFiles: new Set(),
        commitSha: null,
      });
    }
  }

  /** Clone every repo into its localPath and create its feature branch. */
  async cloneAll(): Promise<void> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    for (const repo of this.router.list()) {
      const st = this.must(repo);
      // git clone <cloneUrl> <localPath>  — cwd is workspaceRoot
      gitOrThrow(["clone", repo.cloneUrl, repo.localPath], this.workspaceRoot);
      // Determine the default branch we cloned, then branch off it.
      const base = gitOrThrow(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        repo.localPath,
      );
      gitOrThrow(["checkout", "-b", repo.branch], repo.localPath);
      st.cloned = true;
      st.currentBranch = repo.branch;
      // Stash the base branch for the PR plan.
      st.repo = { ...repo };
      this.baseBranch.set(repoKey(repo), base);
    }
  }

  private readonly baseBranch: Map<string, string> = new Map();

  /**
   * Path-aware write. Resolves which repo owns `absolutePath`; rejects paths
   * outside every repo. Records the edited file against that repo only.
   */
  async writeFile(absolutePath: string, content: string): Promise<WriteResult> {
    const resolution = this.router.resolve(absolutePath);
    if (!resolution) {
      return {
        success: false,
        error: `Path is outside all session repos: ${absolutePath}`,
      };
    }
    const st = this.must(resolution.repo);
    await fs.mkdir(path.dirname(resolution.absolutePath), { recursive: true });
    await fs.writeFile(resolution.absolutePath, content, "utf-8");
    st.dirtyFiles.add(resolution.relativePath);
    return {
      success: true,
      repo: repoKey(resolution.repo),
      relativePath: resolution.relativePath,
      absolutePath: resolution.absolutePath,
    };
  }

  /** Path-aware read, mirroring how readFileTool would route per repo. */
  async readFile(
    absolutePath: string,
  ): Promise<{ success: true; content: string } | { success: false; error: string }> {
    const resolution = this.router.resolve(absolutePath);
    if (!resolution) {
      return {
        success: false,
        error: `Path is outside all session repos: ${absolutePath}`,
      };
    }
    const content = await fs.readFile(resolution.absolutePath, "utf-8");
    return { success: true, content };
  }

  /**
   * Commit one repo's slice. The commit is staged with `git add -A` *within
   * that repo's localPath only*, so it can only ever contain that repo's files
   * — git's index is per-working-tree, which is the isolation guarantee.
   */
  commitRepo(repo: SessionRepo, message: string): CommitResult {
    const st = this.must(repo);
    if (!st.cloned) {
      throw new Error(`Repo ${repoKey(repo)} not cloned`);
    }
    gitOrThrow(["add", "-A"], repo.localPath);
    // Capture exactly what is staged in THIS repo.
    const staged = gitOrThrow(
      ["diff", "--cached", "--name-only"],
      repo.localPath,
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    gitOrThrow(["commit", "-m", message], repo.localPath);
    const sha = gitOrThrow(["rev-parse", "HEAD"], repo.localPath);
    st.commitSha = sha;
    return {
      repo: repoKey(repo),
      branch: repo.branch,
      commitSha: sha,
      files: staged,
    };
  }

  /** git status --porcelain for a repo (used to prove isolation). */
  status(repo: SessionRepo): string {
    return gitOrThrow(["status", "--porcelain"], repo.localPath);
  }

  /** git log oneline for a repo. */
  log(repo: SessionRepo, n = 5): string {
    return gitOrThrow(["log", `-${n}`, "--oneline"], repo.localPath);
  }

  /** Unified diff of the repo's feature branch vs its base branch. */
  diffAgainstBase(repo: SessionRepo): string {
    const base = this.baseBranch.get(repoKey(repo)) ?? "main";
    return gitOrThrow(["diff", `${base}...HEAD`], repo.localPath);
  }

  getState(repo: SessionRepo): RepoWorkingState {
    return this.must(repo);
  }

  /**
   * Build the coordinated linked-PR plan. Each repo gets one PR (head =
   * feature branch, base = the branch it was cloned from). Every PR body is
   * given a cross-reference block pointing at the *other* repos' PRs, stitched
   * together by a shared changeSetId so a reviewer (and the GitHub App that
   * opens them) can see the set is atomic-ish.
   */
  buildLinkedPrPlan(params: {
    changeSetId: string;
    titleFor: (repo: SessionRepo) => string;
  }): LinkedPrPlan {
    const repos = this.router.list();
    const prs: RepoPrPlan[] = repos.map((repo) => {
      const st = this.must(repo);
      return {
        repoOwner: repo.repoOwner,
        repoName: repo.repoName,
        role: repo.role,
        head: repo.branch,
        base: this.baseBranch.get(repoKey(repo)) ?? "main",
        title: params.titleFor(repo),
        prNumber: null,
        url: null,
        commitSha: st.commitSha,
      };
    });

    const crossReferences: Record<string, string> = {};
    for (const repo of repos) {
      const others = repos.filter((r) => repoKey(r) !== repoKey(repo));
      const lines = others.map(
        (r) =>
          `- ${roleLabel(r.role)} repo \`${r.repoOwner}/${r.repoName}\` -> branch \`${r.branch}\``,
      );
      crossReferences[`${repo.repoOwner}/${repo.repoName}`] = [
        `Part of coordinated change set \`${params.changeSetId}\`.`,
        "",
        "This PR must merge together with:",
        ...lines,
      ].join("\n");
    }

    return {
      sessionId: this.sessionId,
      changeSetId: params.changeSetId,
      prs,
      crossReferences,
    };
  }

  private must(repo: SessionRepo): RepoWorkingState {
    const st = this.state.get(repoKey(repo));
    if (!st) {
      throw new Error(`Unknown repo ${repoKey(repo)}`);
    }
    return st;
  }
}

export function repoKey(repo: SessionRepo): string {
  return `${repo.repoOwner}/${repo.repoName}`;
}

function roleLabel(role: string): string {
  return role === "primary" ? "primary" : "secondary";
}
