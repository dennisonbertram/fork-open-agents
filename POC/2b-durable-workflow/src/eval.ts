// Meaningful eval for POC 2b: proves durable crash-resume WITHOUT re-execution.
//
// Strategy: run the workflow across TWO separate OS processes joined only by a
// SQLite file. A `process.exit(137)` between them is a real crash — every byte
// of in-memory state is gone. We then assert, from the persisted log and the
// observable on-disk side effect, that:
//
//   1. Step A's non-idempotent side effect fired EXACTLY ONCE, even though the
//      workflow function ran in two processes (replay, not re-run).
//   2. The run was durably parked at the Step B approval gate across the crash.
//   3. Delivering the external event resumed the run from disk.
//   4. Step C retried with backoff (failed twice, succeeded on the third call)
//      and the run completed with correct final state.
//
// All evidence (process logs + the persisted step log snapshot across the crash
// boundary) is written to evidence/.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowStore } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const evidenceDir = join(root, "evidence");
mkdirSync(evidenceDir, { recursive: true });

const dbPath = join(evidenceDir, ".store-crash-eval.sqlite");
const sideEffectFile = join(evidenceDir, ".store-side-effect.log");
const approvalToken = "approval:run-crash-demo:tool-call-1";

// Clean slate.
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, sideEffectFile]) {
  if (existsSync(f)) {
    rmSync(f);
  }
}

type Json = Record<string, unknown>;
const failures: string[] = [];
let assertionCount = 0;
const assert = (cond: boolean, msg: string) => {
  assertionCount++;
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) {
    failures.push(msg);
  }
};

function runPhase(
  script: string,
): Promise<{ code: number | null; lines: Json[]; raw: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(here, script), dbPath, sideEffectFile, approvalToken],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", (code) => {
      const lines = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Json];
          } catch {
            return [];
          }
        });
      resolve({ code, lines, raw: out });
    });
  });
}

console.log("=== POC 2b: durable crash-resume eval ===\n");

// --- Phase 1: run until Step A done + suspended at Step B, then HARD CRASH ---
console.log(
  "--- Phase 1 (separate process): run to approval gate, then crash ---",
);
const phase1 = await runPhase("crash-phase1.ts");
console.log(phase1.raw.trim());
console.log();

const p1StepA = phase1.lines.find((l) => l.event === "step-A-completed");
const p1Final = phase1.lines.find(
  (l) => (l.outcome as Json | undefined)?.status != null,
);
const crashLine = phase1.lines.find((l) => l.event === "SIMULATED_CRASH");

assert(
  phase1.code === 137,
  `phase 1 process exited with hard-crash code 137 (got ${phase1.code})`,
);
assert(crashLine != null, "phase 1 emitted SIMULATED_CRASH before exit");
assert(
  (p1StepA?.inProcessStepAExecutions as number) === 1,
  "Step A executed exactly once in phase-1 process",
);
assert(
  (p1Final?.outcome as Json | undefined)?.status === "suspended_event",
  "run durably suspended at the approval event before crash",
);

// Capture the persisted log AT the crash boundary (engine instance is dead;
// we open the file fresh, exactly as a recovery process would).
const postCrashStore = new WorkflowStore(dbPath);
const snapshotAtCrash = postCrashStore.snapshot("run-crash-demo");
postCrashStore.close();
writeFileSync(
  join(evidenceDir, "step-log-at-crash.json"),
  JSON.stringify(snapshotAtCrash, null, 2),
);

assert(
  snapshotAtCrash.run?.status === "suspended_event",
  "persisted run row shows status=suspended_event across the crash boundary",
);
assert(
  snapshotAtCrash.steps.find((s) => s.stepKey === "increment-counter")
    ?.status === "completed",
  "Step A is recorded completed in the persisted log",
);
assert(
  snapshotAtCrash.steps.some((s) => s.stepKey === "flaky-finalize") === false,
  "Step C has NOT run yet (no record before the gate)",
);
assert(
  snapshotAtCrash.waiters.some(
    (w) => w.token === approvalToken && w.deliveredAt == null,
  ),
  "an undelivered event waiter is persisted for the approval token",
);

const sideEffectAfterCrash = readFileSync(sideEffectFile, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);
assert(
  sideEffectAfterCrash.length === 1,
  `observable side-effect file has exactly 1 line after crash (got ${sideEffectAfterCrash.length})`,
);

// --- Phase 2: brand-new process resumes from disk only ---
console.log(
  "\n--- Phase 2 (fresh process): resume from disk, deliver event, finish ---",
);
const phase2 = await runPhase("crash-phase2.ts");
console.log(phase2.raw.trim());
console.log();

const firstResume = phase2.lines.find(
  (l) => l.event === "first-resume-from-disk",
);
const finalResume = phase2.lines.find((l) => l.event === "final-resume");

assert(
  (firstResume?.inProcessStepAExecutions as number) === 0,
  "Step A's body NEVER executed in the fresh phase-2 process (replayed from log)",
);
assert(
  (firstResume?.outcome as Json | undefined)?.status === "suspended_event",
  "first resume re-parked at the approval gate (event not yet delivered)",
);
assert(
  (firstResume?.sideEffectLinesBefore as number) === 1,
  "side-effect file still had exactly 1 line when phase 2 started",
);

const finalOutcome = finalResume?.outcome as Json | undefined;
assert(finalOutcome?.status === "completed", "workflow completed after resume");
const finalResult = finalOutcome?.result as Json | undefined;
assert(
  finalResult?.counter === 1,
  "final counter === 1 (side effect not duplicated)",
);
assert(
  finalResult?.finalizeAttempts === 3,
  "Step C succeeded on its 3rd attempt (retry-with-backoff)",
);
assert(
  (finalResume?.sideEffectLinesAfter as number) === 1,
  "observable side-effect file STILL has exactly 1 line after full completion",
);

// Final persisted snapshot for evidence.
const finalStore = new WorkflowStore(dbPath);
const finalSnapshot = finalStore.snapshot("run-crash-demo");
finalStore.close();
writeFileSync(
  join(evidenceDir, "step-log-final.json"),
  JSON.stringify(finalSnapshot, null, 2),
);

assert(
  finalSnapshot.run?.status === "completed",
  "persisted run row is completed at the end",
);
const finalizeRecord = finalSnapshot.steps.find(
  (s) => s.stepKey === "flaky-finalize",
);
assert(
  finalizeRecord?.attempts === 3,
  "persisted log shows flaky-finalize took 3 attempts",
);
assert(
  finalSnapshot.waiters.every((w) => w.deliveredAt != null),
  "persisted waiter was marked delivered",
);

// Copy committed evidence side-effect log (durable sample) and write summary.
writeFileSync(
  join(evidenceDir, "side-effect.log"),
  readFileSync(sideEffectFile, "utf8"),
);

const summary = {
  poc: "2b-durable-workflow",
  ranAt: new Date().toISOString(),
  phase1ExitCode: phase1.code,
  crashSimulated: crashLine != null,
  assertions: {
    total: assertionCount,
    passed: assertionCount - failures.length,
    failed: failures.length,
  },
  durabilityProperties: {
    stepReplayNotRerun: !failures.some((f) => f.includes("Step A")),
    durableEventSuspend: !failures.some((f) => f.includes("approval")),
    retryWithBackoff: !failures.some(
      (f) => f.includes("Step C") || f.includes("attempt"),
    ),
    crashSurvived: phase1.code === 137 && finalOutcome?.status === "completed",
  },
  finalResult,
  evidenceFiles: [
    "step-log-at-crash.json",
    "step-log-final.json",
    "side-effect.log",
    "phase1-output.txt",
    "phase2-output.txt",
  ],
};

writeFileSync(join(evidenceDir, "phase1-output.txt"), phase1.raw);
writeFileSync(join(evidenceDir, "phase2-output.txt"), phase2.raw);

console.log(
  `\n=== RESULT: ${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURES`} (${assertionCount - failures.length}/${assertionCount} assertions) ===`,
);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL: ${f}`);
  }
}

writeFileSync(
  join(evidenceDir, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(`\nEvidence written to ${evidenceDir}`);

process.exit(failures.length === 0 ? 0 : 1);
