// Phase 1 of the REAL crash test, run as its own OS process.
//
// Starts the workflow, lets Step A complete (observable side effect fires once),
// and drives the run to its durable suspend point at Step B (wait-for-approval).
// Then this process EXITS HARD via process.exit(137) — simulating a SIGKILL /
// serverless teardown. All in-memory state (the engine instance, the module
// counter, the JS call stack) is destroyed. Only the SQLite file on disk
// survives. Phase 2 runs in a brand-new process and must resume from that file.
//
// Usage: bun run src/crash-phase1.ts <dbPath> <sideEffectFile> <approvalToken>

import { WorkflowEngine } from "./engine";
import { WorkflowStore } from "./store";
import { demoWorkflow, stepAExecutionCount } from "./workflow";

const [dbPath, sideEffectFile, approvalToken] = process.argv.slice(2);
if (!dbPath || !sideEffectFile || !approvalToken) {
  console.error(
    "usage: bun run src/crash-phase1.ts <dbPath> <sideEffectFile> <approvalToken>",
  );
  process.exit(2);
}

const runId = "run-crash-demo";
const store = new WorkflowStore(dbPath);
const engine = new WorkflowEngine(store);

const outcome = await engine.run(
  "demo-crash",
  runId,
  demoWorkflow,
  { sideEffectFile, approvalToken },
  {
    // Crash the instant Step A's side effect has been committed to the log.
    // This proves the engine had completed A before death; phase 2 must NOT
    // re-run it. We still let the natural flow reach the Step B suspend first
    // so the persisted state is "suspended at B", then kill.
    onAfterStep: (key) => {
      if (key === "increment-counter") {
        console.log(
          JSON.stringify({
            phase: 1,
            event: "step-A-completed",
            inProcessStepAExecutions: stepAExecutionCount(),
          }),
        );
      }
    },
  },
);

console.log(
  JSON.stringify({
    phase: 1,
    outcome,
    inProcessStepAExecutions: stepAExecutionCount(),
  }),
);

if (outcome.status !== "suspended_event") {
  console.error("phase 1 expected to suspend at the approval event");
  process.exit(1);
}

store.close();

// HARD CRASH: 128 + SIGKILL(9). No graceful shutdown, no flush hooks beyond what
// SQLite WAL already durably committed.
console.log(JSON.stringify({ phase: 1, event: "SIMULATED_CRASH", code: 137 }));
process.exit(137);
