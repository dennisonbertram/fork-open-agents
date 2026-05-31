// POC 4c eval — proves snapshot -> teardown -> resume restores sandbox state
// across a hibernate/wake lifecycle, against a local fake SnapshotProvider.
//
//   bun run src/eval.ts
//
// Scenario (a realistic "multi-day task"):
//   1. Provision a sandbox; build a working tree with:
//        - committed files
//        - a STAGED edit, an UNSTAGED edit, an UNTRACKED file (the POC 3b blind spot)
//        - an executable-mode file + a binary file
//        - a file created MID-SESSION (day-1 work)
//      Register two services: a dev_server (relaunchOnResume=true) and a
//      one-off code_editor (relaunchOnResume=false). Both "running" (have pids).
//   2. Fingerprint the filesystem (pre-snapshot manifest).
//   3. Hibernate: active -> hibernating -> [snapshot + TEAR DOWN live instance]
//      -> hibernated. Assert the live workdir is gone.
//   4. Resume into a NEW session: hibernated -> restoring -> active.
//      Assert: filesystem byte-identical (rootHash match), git working state
//      intact (staged/unstaged/untracked all present), relaunchOnResume=true
//      service re-launched with a NEW pid, relaunchOnResume=false service NOT
//      relaunched.
//   5. Do MORE work (day-2), hibernate + resume AGAIN, assert the day-2 file
//      also survives -> proves a multi-day task across TWO cycles.
//   6. Write transition log + pre/post manifests + cost table to evidence/.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, tryRun } from "./exec";
import { LocalFakeSnapshotProvider } from "./fake-provider";
import { compare, fingerprint, type FsManifest } from "./fidelity";
import { SandboxOrchestrator } from "./orchestrator";
import type { SandboxInstance } from "./provider";
import { HIBERNATION_SURVIVAL, type ServiceRecord } from "./service-records";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", "evidence");

let passed = 0;
let failed = 0;
const lines: string[] = [];
function log(s = "") {
  lines.push(s);
  console.log(s);
}
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    log(`  PASS ${msg}`);
  } else {
    failed++;
    log(`  FAIL ${msg}`);
  }
}

function gitInit(dir: string) {
  run("git init -q", dir);
  run('git config user.email "poc@example.com"', dir);
  run('git config user.name "POC 4c"', dir);
  run("git config commit.gpgsign false", dir);
}

// Build a realistic mixed git working tree inside a sandbox instance.
function seedWorkingTree(inst: SandboxInstance) {
  const w = inst.workdir;
  gitInit(w);
  // committed baseline
  writeFileSync(join(w, "README.md"), "# project\nbaseline\n");
  mkdirSync(join(w, "src"), { recursive: true });
  writeFileSync(join(w, "src", "app.ts"), "export const v = 1;\n");
  writeFileSync(join(w, "tracked.txt"), "original\n");
  // executable-mode file
  writeFileSync(join(w, "run.sh"), "#!/bin/sh\necho hi\n");
  chmodSync(join(w, "run.sh"), 0o755);
  // small binary
  writeFileSync(join(w, "blob.bin"), Buffer.from([0, 1, 2, 253, 254, 255]));
  run("git add -A", w);
  run('git commit -q -m "baseline"', w);

  // STAGED edit
  writeFileSync(join(w, "src", "app.ts"), "export const v = 2; // staged\n");
  run("git add src/app.ts", w);
  // UNSTAGED edit to a tracked file
  writeFileSync(join(w, "tracked.txt"), "original\nunstaged edit\n");
  // UNTRACKED file
  writeFileSync(join(w, "scratch.notes"), "untracked agent notes\n");
}

function gitStatus(dir: string): string {
  return run("git status --porcelain=v1", dir).trim();
}

function makeServices(): ServiceRecord[] {
  return [
    {
      id: "svc_dev",
      kind: "dev_server",
      status: "running",
      packageDir: ".",
      command: "bun run dev --port 3000",
      port: 3000,
      relaunchOnResume: true,
      pid: "pid_initial_dev",
    },
    {
      id: "svc_editor",
      kind: "code_editor",
      status: "running",
      packageDir: ".",
      command: "code-server --port 8080",
      port: 8080,
      relaunchOnResume: false,
      pid: "pid_initial_editor",
    },
  ];
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), "poc4c-"));
  const provider = new LocalFakeSnapshotProvider(root);

  log("=== POC 4c: persistent / snapshottable VMs — hibernate/resume eval ===");
  log("");
  log("--- Phase 1: provision sandbox + build day-1 working state ---");
  const sandbox = provider.provision("session_multiday", {
    OPENAGENTS_SESSION: "session_multiday",
  });
  seedWorkingTree(sandbox);
  sandbox.services = makeServices();
  // day-1 mid-session artifact
  writeFileSync(join(sandbox.workdir, "day1-progress.txt"), "step 1 done\n");

  const orch = new SandboxOrchestrator(provider, sandbox);
  assert(orch.state === "active", "lifecycle reaches active after provisioning");

  const day1Status = gitStatus(sandbox.workdir);
  log(`  git status (pre-snapshot):\n${indent(day1Status)}`);
  const preManifest: FsManifest = fingerprint(sandbox.workdir);
  log(
    `  filesystem: ${preManifest.fileCount} files, ${preManifest.totalBytes} bytes, rootHash=${preManifest.rootHash.slice(0, 16)}…`,
  );
  const liveWorkdir = sandbox.workdir;

  log("");
  log("--- Phase 2: HIBERNATE (snapshot + tear down live instance) ---");
  const ref1 = await orch.hibernate("idle-timeout");
  assert(orch.state === "hibernated", "lifecycle reaches hibernated");
  assert(orch.live === null, "live instance handle dropped after hibernate");
  assert(
    !existsSync(liveWorkdir),
    "live workdir physically torn down (discarded)",
  );
  assert(ref1.sizeBytes > 0, `snapshot has nonzero size (${ref1.sizeBytes} B)`);

  log("");
  log("--- Phase 3: RESUME into a NEW session ---");
  const { instance: resumed1, relaunch: relaunch1 } = await orch.resume();
  assert(orch.state === "active", "lifecycle returns to active after resume");
  assert(
    resumed1.sessionId !== sandbox.sessionId,
    `resume created a NEW session id (${sandbox.sessionId} -> ${resumed1.sessionId})`,
  );
  assert(
    resumed1.name === sandbox.name,
    "durable sandbox name survives across sessions",
  );

  // Filesystem byte-restore.
  const postManifest = fingerprint(resumed1.workdir);
  const diff = compare(preManifest, postManifest);
  assert(
    diff.identical,
    `filesystem byte-restored (rootHash match: ${postManifest.rootHash === preManifest.rootHash})`,
  );
  if (!diff.identical) {
    log(`    missing=${diff.missing.join(",")}`);
    log(`    added=${diff.added.join(",")}`);
    log(`    changed=${diff.changed.join(",")}`);
  }

  // Git working state intact.
  const resumedStatus = gitStatus(resumed1.workdir);
  assert(
    resumedStatus === day1Status,
    "git porcelain status identical after resume",
  );
  assert(
    resumedStatus.includes("M  src/app.ts"),
    "STAGED edit survived (index intact)",
  );
  assert(
    resumedStatus.includes(" M tracked.txt"),
    "UNSTAGED edit survived (worktree intact)",
  );
  assert(
    resumedStatus.includes("?? scratch.notes"),
    "UNTRACKED file survived (POC 3b blind spot)",
  );
  const logOk = tryRun("git log --oneline", resumed1.workdir);
  assert(
    logOk.ok && logOk.out.includes("baseline"),
    "git commit history intact",
  );

  // Service relaunch contract.
  assert(
    relaunch1.relaunched.includes("svc_dev"),
    "relaunchOnResume=true dev_server WAS relaunched",
  );
  assert(
    relaunch1.skipped.includes("svc_editor"),
    "relaunchOnResume=false code_editor was NOT relaunched",
  );
  const devSvc = resumed1.services.find((s) => s.id === "svc_dev");
  const editorSvc = resumed1.services.find((s) => s.id === "svc_editor");
  assert(
    devSvc?.status === "running" && !!devSvc?.pid,
    "relaunched dev_server is running with a pid",
  );
  assert(
    devSvc?.pid !== "pid_initial_dev",
    `dev_server got a NEW pid (process recreated, not restored): ${devSvc?.pid}`,
  );
  assert(
    editorSvc?.status === "stopped" && editorSvc?.pid === null,
    "non-relaunch code_editor is stopped with null pid (process did not survive)",
  );
  // env survives (it lives in the snapshot sidecar / sandbox config)
  assert(
    resumed1.env.OPENAGENTS_SESSION === "session_multiday",
    "session env survived hibernation",
  );

  log("");
  log("--- Phase 4: day-2 work, then a SECOND hibernate/resume cycle ---");
  writeFileSync(join(resumed1.workdir, "day2-progress.txt"), "step 2 done\n");
  run("git add day2-progress.txt", resumed1.workdir);
  const day2Manifest = fingerprint(resumed1.workdir);
  const ref2 = await orch.hibernate("idle-timeout");
  assert(orch.state === "hibernated", "second hibernate reaches hibernated");
  const { instance: resumed2 } = await orch.resume();
  assert(orch.state === "active", "second resume reaches active");
  const day2Post = fingerprint(resumed2.workdir);
  assert(
    compare(day2Manifest, day2Post).identical,
    "day-2 filesystem byte-restored across the SECOND cycle",
  );
  assert(
    existsSync(join(resumed2.workdir, "day1-progress.txt")) &&
      existsSync(join(resumed2.workdir, "day2-progress.txt")),
    "BOTH day-1 and day-2 artifacts present (multi-day task survived 2 cycles)",
  );

  log("");
  log("--- Phase 5: survival contract assertions ---");
  assert(HIBERNATION_SURVIVAL.filesystem, "contract: filesystem survives");
  assert(
    HIBERNATION_SURVIVAL.gitWorkingTree,
    "contract: git working tree survives",
  );
  assert(
    HIBERNATION_SURVIVAL.serviceRecords,
    "contract: service records survive (DB-backed)",
  );
  assert(
    !HIBERNATION_SURVIVAL.runningProcesses,
    "contract: running processes do NOT survive (must relaunch)",
  );
  assert(
    !HIBERNATION_SURVIVAL.inMemoryState,
    "contract: in-memory state does NOT survive",
  );

  log("");
  log("--- Lifecycle transition trail ---");
  log(`  ${orch.machine.trail()}`);
  const expectedTrail =
    "provisioning -> active -> hibernating -> hibernated -> restoring -> active -> hibernating -> hibernated -> restoring -> active";
  assert(
    orch.machine.trail() === expectedTrail,
    "transition trail matches expected hibernate/resume path (x2)",
  );

  log("");
  log("--- Snapshot cost characterization (fake mechanism) ---");
  for (const c of provider.costs) {
    log(
      `  ${c.snapshotId}: size=${c.sizeBytes} B, snapshot=${c.snapshotMs.toFixed(1)}ms, resume=${c.resumeMs.toFixed(1)}ms`,
    );
  }

  // ---- write evidence ----
  writeEvidence(orch, preManifest, postManifest, provider, {
    day1Status,
    resumedStatus,
  });

  log("");
  log(`=== RESULT: ${passed} passed, ${failed} failed ===`);

  rmSync(root, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

function writeEvidence(
  orch: SandboxOrchestrator,
  pre: FsManifest,
  post: FsManifest,
  provider: LocalFakeSnapshotProvider,
  git: { day1Status: string; resumedStatus: string },
) {
  writeFileSync(join(EVIDENCE, "00-eval-output.txt"), `${lines.join("\n")}\n`);

  writeFileSync(
    join(EVIDENCE, "01-lifecycle-transitions.json"),
    JSON.stringify(
      {
        trail: orch.machine.trail(),
        transitions: orch.machine.transitions,
      },
      null,
      2,
    ),
  );

  const manifest = (m: FsManifest) =>
    [
      `rootHash: ${m.rootHash}`,
      `fileCount: ${m.fileCount}`,
      `totalBytes: ${m.totalBytes}`,
      "",
      ...m.entries.map((e) => `${e.mode} ${e.sha256}  ${e.path}`),
    ].join("\n");

  writeFileSync(
    join(EVIDENCE, "02-fs-manifest-pre-snapshot.txt"),
    `${manifest(pre)}\n`,
  );
  writeFileSync(
    join(EVIDENCE, "03-fs-manifest-post-resume.txt"),
    `${manifest(post)}\n`,
  );
  writeFileSync(
    join(EVIDENCE, "04-git-working-state.txt"),
    `# git status --porcelain BEFORE hibernate:\n${git.day1Status}\n\n# git status --porcelain AFTER resume:\n${git.resumedStatus}\n`,
  );
  writeFileSync(
    join(EVIDENCE, "05-snapshot-cost.json"),
    JSON.stringify(provider.costs, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
