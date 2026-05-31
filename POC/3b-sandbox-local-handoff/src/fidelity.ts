// Fidelity assertions: prove two working trees are BYTE-EXACT, including the
// staged/unstaged/untracked split, file modes, and binary bytes.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { run } from "./exec-seam";

export interface RepoFingerprint {
  branch: string;
  head: string;
  // full commit graph (sha + parents), order-stable
  graph: string;
  // git status, the authoritative staged/unstaged/untracked view
  statusV2: string;
  // staged-only diff and unstaged-only diff, separated
  diffCached: string;
  diffUnstaged: string;
  // sha256 of every file on disk (incl untracked), with mode, sorted
  fileManifest: string;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Walk the working tree (excluding .git) and hash every file with its mode.
function fileManifest(repoDir: string): string {
  const rows: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        const st = statSync(abs);
        // mode masked to permission + exec bits (portable subset)
        const mode = (st.mode & 0o777).toString(8);
        const rel = relative(repoDir, abs);
        rows.push(`${mode} ${sha256(readFileSync(abs))} ${rel}`);
      }
    }
  };
  walk(repoDir);
  return rows.sort().join("\n");
}

export function fingerprint(repoDir: string): RepoFingerprint {
  return {
    branch: run("git symbolic-ref --short HEAD", repoDir).trim(),
    head: run("git rev-parse HEAD", repoDir).trim(),
    // Commit-graph fidelity == the history reachable from HEAD is identical.
    // (We intentionally do NOT use --all: that pulls in remote-tracking refs on
    // the clone and transient refs/handoff/* on the source, which are transport
    // bookkeeping, not part of the handed-off branch state.)
    graph: run("git log HEAD --pretty=format:'%H %P'", repoDir).trim(),
    statusV2: run(
      "git -c core.quotepath=false status -uall --porcelain=v2",
      repoDir,
    )
      .split("\n")
      .filter(Boolean)
      .sort()
      .join("\n"),
    diffCached: run("git diff --cached", repoDir),
    diffUnstaged: run("git diff", repoDir),
    fileManifest: fileManifest(repoDir),
  };
}

export interface FieldResult {
  field: string;
  equal: boolean;
}

export function compare(
  a: RepoFingerprint,
  b: RepoFingerprint,
): { ok: boolean; fields: FieldResult[] } {
  const fields: FieldResult[] = (
    [
      "branch",
      "head",
      "graph",
      "statusV2",
      "diffCached",
      "diffUnstaged",
      "fileManifest",
    ] as const
  ).map((field) => ({ field, equal: a[field] === b[field] }));
  return { ok: fields.every((f) => f.equal), fields };
}
