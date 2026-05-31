// POC 3b eval — proves byte-exact sandbox<->local state handoff in BOTH
// directions, including the uncommitted staged/unstaged/untracked blind spot.
//
//   bun run src/eval.ts
//
// What it does:
//   1. Builds a "sandbox" git repo with a realistic mixed state:
//        - feature branch, 2 commits ahead of main
//        - a STAGED modification
//        - an UNSTAGED modification to a tracked file
//        - a brand-new UNTRACKED file
//        - a DELETED tracked file (unstaged deletion)
//        - an EXECUTABLE-mode file
//        - a small BINARY file
//   2. Exports it to a portable bundle (export-state.sh).
//   3. Clones the repo fresh ("local") and imports the bundle (continue-locally.sh).
//   4. Asserts the two working trees are BYTE-EXACT (fidelity.ts).
//   5. Repeats in reverse (local -> fresh sandbox clone).
//   6. Writes status dumps + hash manifests to evidence/.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./exec-seam";
import { compare, fingerprint, type RepoFingerprint } from "./fidelity";

const HERE = dirname(fileURLToPath(import.meta.url));
const POC_ROOT = join(HERE, "..");
const SCRIPTS = join(POC_ROOT, "scripts");
const EVIDENCE = join(POC_ROOT, "evidence");

const EXPORT = join(SCRIPTS, "export-state.sh");
const IMPORT = join(SCRIPTS, "import-state.sh");

function gitInit(dir: string) {
  run("git init -q", dir);
  run('git config user.email "poc@example.com"', dir);
  run('git config user.name "POC"', dir);
  run("git config commit.gpgsign false", dir);
}

// Build a bare "origin" + a working checkout with the realistic mixed state.
// Returns { origin, work }.
function buildSourceRepo(root: string): { origin: string; work: string } {
  const origin = join(root, "origin.git");
  const work = join(root, "sandbox");
  mkdirSync(origin, { recursive: true });
  run("git init -q --bare", origin);

  mkdirSync(work, { recursive: true });
  gitInit(work);
  run(`git remote add origin "${origin}"`, work);

  // --- main: baseline ---
  writeFileSync(join(work, "README.md"), "# project\n");
  writeFileSync(join(work, "tracked.txt"), "original tracked line\n");
  writeFileSync(join(work, "to-delete.txt"), "this file will be deleted\n");
  // executable file committed with exec bit
  writeFileSync(join(work, "run.sh"), "#!/bin/sh\necho hi\n");
  chmodSync(join(work, "run.sh"), 0o755);
  // binary file committed
  writeFileSync(
    join(work, "logo.bin"),
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x00, 0x7f]),
  );
  run("git add -A", work);
  run("git -c core.fileMode=true commit -qm 'baseline on main'", work);
  run("git branch -M main", work);

  // --- feature branch, 2 commits ahead ---
  run("git checkout -q -b feature", work);
  writeFileSync(join(work, "feature-a.txt"), "feature commit 1\n");
  run("git add -A", work);
  run("git commit -qm 'feature commit 1'", work);
  writeFileSync(join(work, "feature-b.txt"), "feature commit 2\n");
  run("git add -A", work);
  run("git commit -qm 'feature commit 2'", work);

  // push both branches to origin so a fresh clone can reproduce the graph
  run("git push -q origin main feature", work);

  // --- now create the realistic UNCOMMITTED mixed state ---
  // STAGED modification to tracked.txt
  writeFileSync(join(work, "tracked.txt"), "STAGED edit\n");
  run("git add tracked.txt", work);
  // ...then an UNSTAGED further modification on top (status MM)
  writeFileSync(join(work, "tracked.txt"), "STAGED edit\nthen UNSTAGED edit\n");

  // UNSTAGED deletion of a tracked file
  rmSync(join(work, "to-delete.txt"));

  // brand-new UNTRACKED file (with content we will hash)
  writeFileSync(join(work, "scratch-notes.txt"), "untracked scratch notes\n");

  // a STAGED brand-new file (added but not committed)
  writeFileSync(join(work, "staged-new.txt"), "freshly staged new file\n");
  run("git add staged-new.txt", work);

  // modify the executable file (unstaged) — exec bit must survive
  writeFileSync(join(work, "run.sh"), "#!/bin/sh\necho hi\necho more\n");
  chmodSync(join(work, "run.sh"), 0o755);

  // modify the binary file (unstaged) — must stay byte-identical
  writeFileSync(
    join(work, "logo.bin"),
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x00, 0x7f, 0xab, 0xcd]),
  );

  return { origin, work };
}

function saveEvidence(name: string, fp: RepoFingerprint) {
  const body = [
    `# ${name}`,
    `branch: ${fp.branch}`,
    `head:   ${fp.head}`,
    "",
    "## git status -uall --porcelain=v2 (sorted)",
    fp.statusV2,
    "",
    "## git diff --cached (staged)",
    fp.diffCached,
    "",
    "## git diff (unstaged)",
    fp.diffUnstaged,
    "",
    "## file manifest (mode sha256 path, sorted)",
    fp.fileManifest,
    "",
    "## commit graph (sha parents)",
    fp.graph,
    "",
  ].join("\n");
  writeFileSync(join(EVIDENCE, `${name}.txt`), body);
}

function report(label: string, src: RepoFingerprint, dst: RepoFingerprint) {
  const { ok, fields } = compare(src, dst);
  console.log(`\n=== ${label} ===`);
  for (const f of fields) {
    console.log(`  [${f.equal ? "PASS" : "FAIL"}] ${f.field}`);
  }
  console.log(`  => ${ok ? "BYTE-EXACT FIDELITY" : "MISMATCH"}`);
  return ok;
}

function main() {
  rmSync(EVIDENCE, { recursive: true, force: true });
  mkdirSync(EVIDENCE, { recursive: true });

  const root = mkdtempSync(join(tmpdir(), "poc3b-"));
  let allOk = true;

  try {
    // ---------------------------------------------------------------
    // DIRECTION 1: sandbox -> local
    // ---------------------------------------------------------------
    const { origin, work: sandbox } = buildSourceRepo(root);
    const srcFp = fingerprint(sandbox);
    saveEvidence("01-source-sandbox", srcFp);

    const bundle = join(root, "handoff.bundle");
    console.log(run(`"${EXPORT}" "${sandbox}" "${bundle}"`, sandbox));

    // fresh "local" clone from origin, then import the handoff
    const local = join(root, "local");
    run(`git clone -q "${origin}" "${local}"`, root);
    run(`git config core.fileMode true`, local);
    console.log(run(`"${IMPORT}" "${local}" "${bundle}"`, local));

    const localFp = fingerprint(local);
    saveEvidence("02-restored-local", localFp);
    allOk = report("DIRECTION 1: sandbox -> local", srcFp, localFp) && allOk;

    // ---------------------------------------------------------------
    // DIRECTION 2: local -> fresh sandbox clone (reverse)
    // We treat the restored "local" repo as the new source of truth, export
    // it, and re-hydrate a brand-new sandbox clone.
    // ---------------------------------------------------------------
    const bundle2 = join(root, "handoff-reverse.bundle");
    console.log(run(`"${EXPORT}" "${local}" "${bundle2}"`, local));

    const sandbox2 = join(root, "sandbox2");
    run(`git clone -q "${origin}" "${sandbox2}"`, root);
    run(`git config core.fileMode true`, sandbox2);
    console.log(run(`"${IMPORT}" "${sandbox2}" "${bundle2}"`, sandbox2));

    const sandbox2Fp = fingerprint(sandbox2);
    saveEvidence("03-restored-sandbox-reverse", sandbox2Fp);
    allOk =
      report("DIRECTION 2: local -> fresh sandbox", localFp, sandbox2Fp) &&
      allOk;

    // status diff evidence (should be empty)
    const statusDiff1 =
      srcFp.statusV2 === localFp.statusV2 ? "(identical)" : "(DIFFERS)";
    const statusDiff2 =
      localFp.statusV2 === sandbox2Fp.statusV2 ? "(identical)" : "(DIFFERS)";
    writeFileSync(
      join(EVIDENCE, "00-summary.txt"),
      [
        "POC 3b fidelity summary",
        "",
        `direction 1 (sandbox -> local) status match: ${statusDiff1}`,
        `direction 2 (local -> sandbox) status match: ${statusDiff2}`,
        "",
        `overall: ${allOk ? "PASS — byte-exact both directions" : "FAIL"}`,
        "",
        "See 01/02/03 dumps for full status, staged/unstaged diffs, and sha256 manifests.",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nEvidence written to ${EVIDENCE}`);
  if (!allOk) {
    console.error("\nFIDELITY FAILED");
    process.exit(1);
  }
  console.log("\nALL FIDELITY CHECKS PASSED (both directions)");
}

main();
