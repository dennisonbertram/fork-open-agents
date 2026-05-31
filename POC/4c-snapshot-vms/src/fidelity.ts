// Filesystem fidelity fingerprinting. Produces a deterministic manifest of
// every file under a directory (path -> mode + sha256). Used to assert that the
// resumed filesystem is BYTE-restored, and to characterize snapshot size.
//
// Reuses POC 3b's insight: the git WORKING tree (including uncommitted +
// untracked files) is part of the filesystem, so a filesystem-level snapshot
// captures it for free — no separate git bundle needed when the whole disk is
// archived. The git-bundle path from POC 3b is the FALLBACK for platforms that
// only snapshot committed state; here we verify the full-disk path.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface FileEntry {
  path: string; // relative path
  mode: string; // octal permission string, e.g. "755"
  sha256: string; // content hash ("<symlink>" target hash for symlinks)
}

export interface FsManifest {
  entries: FileEntry[];
  fileCount: number;
  totalBytes: number;
  /** Single hash over the whole manifest — one number that means "identical". */
  rootHash: string;
}

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, base, out);
    } else {
      out.push(abs);
    }
  }
}

export function fingerprint(dir: string): FsManifest {
  const files: string[] = [];
  walk(dir, dir, files);

  const entries: FileEntry[] = [];
  let totalBytes = 0;
  for (const abs of files.sort()) {
    const st = statSync(abs);
    const buf = readFileSync(abs);
    totalBytes += buf.length;
    entries.push({
      path: relative(dir, abs),
      mode: (st.mode & 0o777).toString(8),
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }

  const rootHash = createHash("sha256")
    .update(
      entries.map((e) => `${e.path}\t${e.mode}\t${e.sha256}`).join("\n"),
    )
    .digest("hex");

  return { entries, fileCount: entries.length, totalBytes, rootHash };
}

export interface FidelityDiff {
  identical: boolean;
  missing: string[]; // present in a, absent in b
  added: string[]; // present in b, absent in a
  changed: string[]; // present in both, different mode or hash
}

export function compare(a: FsManifest, b: FsManifest): FidelityDiff {
  const ma = new Map(a.entries.map((e) => [e.path, e]));
  const mb = new Map(b.entries.map((e) => [e.path, e]));
  const missing: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];

  for (const [p, ea] of ma) {
    const eb = mb.get(p);
    if (!eb) {
      missing.push(p);
    } else if (eb.sha256 !== ea.sha256 || eb.mode !== ea.mode) {
      changed.push(p);
    }
  }
  for (const p of mb.keys()) {
    if (!ma.has(p)) added.push(p);
  }

  return {
    identical:
      missing.length === 0 && added.length === 0 && changed.length === 0,
    missing,
    added,
    changed,
  };
}
