// Phase 2 of the REAL crash test, run as a BRAND-NEW OS process.
//
// This process shares NOTHING with phase 1 except the SQLite file on disk. The
// engine is re-instantiated from that file only. It must:
//   1. Replay Step A from the log WITHOUT re-executing it (so the in-process
//      execution counter for A stays 0 in THIS process, and the on-disk
//      side-effect file still has exactly one line).
//   2. Resume waiting at Step B (the approval event has not arrived yet).
//   3. After the external event is delivered, retry Step C with backoff until
//      it succeeds, then complete with correct final state.
//
// Usage: bun run src/crash-phase2.ts <dbPath> <sideEffectFile> <approvalToken>

import { readFileSync } from "node:fs";
import { WorkflowEngine } from "./engine";
import { WorkflowStore } from "./store";
import { demoWorkflow, stepAExecutionCount } from "./workflow";

const [dbPath, sideEffectFile, approvalToken] = process.argv.slice(2);
if (!dbPath || !sideEffectFile || !approvalToken) {
  console.error(
    "usage: bun run src/crash-phase2.ts <dbPath> <sideEffectFile> <approvalToken>",
  );
  process.exit(2);
}

const runId = "run-crash-demo";
const store = new WorkflowStore(dbPath);
const engine = new WorkflowEngine(store);

const sideEffectLinesBefore = readFileSync(sideEffectFile, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean).length;

// First resume attempt: replays A from log, re-suspends at B (event not yet
// delivered). Proves the run survived as "suspended at the approval gate".
const resume1 = await engine.run("demo-crash", runId, demoWorkflow, {
  sideEffectFile,
  approvalToken,
});

console.log(
  JSON.stringify({
    phase: 2,
    event: "first-resume-from-disk",
    outcome: resume1,
    // CRITICAL: in THIS fresh process, Step A's body must never have run.
    inProcessStepAExecutions: stepAExecutionCount(),
    sideEffectLinesBefore,
  }),
);

// Deliver the external approval event (the 1b approve / 2c webhook / 2a trigger
// seam). In production this is an HTTP endpoint calling store.deliverEvent.
const notified = store.deliverEvent(approvalToken, {
  approved: true,
  approver: "operator@example.com",
});
console.log(
  JSON.stringify({
    phase: 2,
    event: "event-delivered",
    notifiedRuns: notified,
  }),
);

// Second resume: event present, Step A still replayed (not re-run), Step C
// retries with backoff to completion.
const resume2 = await engine.run("demo-crash", runId, demoWorkflow, {
  sideEffectFile,
  approvalToken,
});

const sideEffectLinesAfter = readFileSync(sideEffectFile, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean).length;

console.log(
  JSON.stringify({
    phase: 2,
    event: "final-resume",
    outcome: resume2,
    inProcessStepAExecutions: stepAExecutionCount(),
    sideEffectLinesAfter,
  }),
);

store.close();
