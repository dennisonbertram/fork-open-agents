// Second eval: proves the durable `sleep` primitive survives a crash.
//
// Models the 2a cron-delay / scheduled-resume case: a workflow sleeps for a
// fixed duration. We run it in process #1 (it suspends because the deadline is
// in the future), HARD-CRASH, then resume in a fresh process #2. The wake-at
// deadline is read from disk; the sleep must expire at the ORIGINAL wall-clock
// time, not be restarted. We assert the persisted wakeAt is stable across the
// crash and that the second process only completes once that absolute time has
// passed — i.e. the timer is durable, not an in-memory setTimeout.
//
// Runs both phases in-process here (the step-replay/event crash test already
// proved cross-OS-process durability with exit(137)); this eval isolates the
// sleep deadline-persistence property against a fresh engine instance after the
// store is closed and reopened, which is the same teardown boundary.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowEngine, type WorkflowContext } from "./engine";
import { WorkflowStore } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(here, "..", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const dbPath = join(evidenceDir, ".store-sleep-eval.sqlite");
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(f)) {
    rmSync(f);
  }
}

const failures: string[] = [];
const assert = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) {
    failures.push(msg);
  }
};

const SLEEP_MS = 1_500;
const runId = "run-sleep-demo";

// A scheduled workflow: do a setup step, sleep, then a wake step.
let wakeStepExecutions = 0;
const scheduledWorkflow = async (_input: unknown, ctx: WorkflowContext) => {
  await ctx.step("schedule-setup", () => ({ scheduledAt: Date.now() }));
  await ctx.sleep("cron-delay", SLEEP_MS);
  return await ctx.step("on-wake", () => {
    wakeStepExecutions++;
    return { wokeAt: Date.now() };
  });
};

console.log("=== POC 2b: durable sleep crash-resume eval ===\n");

// --- Process #1: start, suspend on sleep, then "crash" (close store) ---
const store1 = new WorkflowStore(dbPath);
const engine1 = new WorkflowEngine(store1);
const r1 = await engine1.run("sleep-demo", runId, scheduledWorkflow, {});
console.log("phase 1 outcome:", JSON.stringify(r1));
assert(r1.status === "suspended_sleep", "run suspended on durable sleep");
const wakeAt1 = r1.status === "suspended_sleep" ? r1.wakeAt : "";
const snap1 = store1.snapshot(runId);
store1.close(); // teardown: engine + in-memory timers gone

assert(
  snap1.sleeps[0]?.wakeAt === wakeAt1 && wakeAt1 !== "",
  "wake-at deadline persisted to disk",
);
assert(snap1.sleeps[0]?.firedAt == null, "sleep not yet fired before deadline");

// --- Fresh engine, resume BEFORE the deadline: must re-suspend, not wake ---
const storeEarly = new WorkflowStore(dbPath);
const engineEarly = new WorkflowEngine(storeEarly);
const rEarly = await engineEarly.run(
  "sleep-demo",
  runId,
  scheduledWorkflow,
  {},
);
console.log("early resume outcome:", JSON.stringify(rEarly));
storeEarly.close();
assert(
  rEarly.status === "suspended_sleep",
  "early resume (before deadline) re-suspends instead of waking",
);
assert(
  rEarly.status === "suspended_sleep" && rEarly.wakeAt === wakeAt1,
  "wake-at deadline UNCHANGED across resume (timer not restarted)",
);

// --- Wait past the original deadline, then resume in another fresh engine ---
const remaining = Date.parse(wakeAt1) - Date.now();
if (remaining > 0) {
  await new Promise((resolve) => setTimeout(resolve, remaining + 50));
}
const store2 = new WorkflowStore(dbPath);
const engine2 = new WorkflowEngine(store2);
const r2 = await engine2.run("sleep-demo", runId, scheduledWorkflow, {});
console.log("phase 2 outcome:", JSON.stringify(r2));
const snap2 = store2.snapshot(runId);
store2.close();

assert(r2.status === "completed", "run completes after deadline passes");
assert(
  wakeStepExecutions === 1,
  "on-wake step executed exactly once (setup replayed, not re-run)",
);
assert(
  snap2.steps.find((s) => s.stepKey === "schedule-setup")?.status ===
    "completed",
  "setup step replayed from log across the sleep crash boundary",
);
assert(snap2.sleeps[0]?.firedAt != null, "sleep recorded as fired");

writeFileSync(
  join(evidenceDir, "sleep-step-log.json"),
  JSON.stringify({ atSuspend: snap1, afterWake: snap2 }, null, 2),
);

console.log(
  `\n=== SLEEP RESULT: ${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURES`} ===`,
);
process.exit(failures.length === 0 ? 0 : 1);
