// The workflow under test, modeling a long-running agent run that must survive
// a crash. Three steps stress the three durability properties:
//
//   Step A "increment-counter": a step with an OBSERVABLE, NON-IDEMPOTENT side
//     effect — it appends a line to a real file on disk and bumps a counter.
//     If the engine ever re-EXECUTED a completed step (instead of replaying its
//     logged result), this file would gain a second line and the counter would
//     read 2. The file is the physical proof of replay-not-rerun across crashes.
//
//   Step B "wait-for-approval": a durable waitForEvent suspend point. Models the
//     1b approval park (a human approves a tool call) and, more generally, the
//     2c external-event / 2a cron-trigger resume seam. The run parks here with
//     ZERO in-memory state — only the persisted waiter row keeps it alive.
//
//   Step C "flaky-finalize": a step that FAILS its first two attempts and
//     succeeds on the third, exercising retry-with-backoff. Attempt counts are
//     persisted, so retries are also crash-safe.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { WorkflowContext } from "./engine";

export type DemoInput = {
  sideEffectFile: string; // path to the observable side-effect log
  approvalToken: string; // token an external actor delivers to resume step B
};

export type DemoOutput = {
  counter: number;
  approval: { approved: boolean; approver: string };
  finalizeAttempts: number;
  done: true;
};

// Module-level, NON-durable counter. It is reset every time the process starts
// (and thus every time the engine is re-instantiated after a crash). If step A
// were re-run on resume, this would be incremented again; because A is replayed
// from the log, the side effect never repeats. We read the authoritative value
// back from the on-disk file, which is the true cross-process side-effect proof.
let inMemoryExecutionsOfStepA = 0;

export function stepAExecutionCount(): number {
  return inMemoryExecutionsOfStepA;
}

// A flaky external dependency that fails the first two calls per process.
// (Process-scoped so a fresh process retries cleanly; the engine persists the
// cumulative attempt count, so total attempts across the run are deterministic.)
let finalizeCalls = 0;

export function resetFinalizeCalls(): void {
  finalizeCalls = 0;
}

export const demoWorkflow = async (
  input: DemoInput,
  ctx: WorkflowContext,
): Promise<DemoOutput> => {
  // --- Step A: observable, non-idempotent side effect ---
  const counter = await ctx.step("increment-counter", () => {
    inMemoryExecutionsOfStepA++;
    const prev = existsSync(input.sideEffectFile)
      ? Number(
          readFileSync(input.sideEffectFile, "utf8").trim().split("\n").length,
        )
      : 0;
    const next = prev + 1;
    appendFileSync(
      input.sideEffectFile,
      `increment #${next} at ${new Date().toISOString()}\n`,
    );
    return next;
  });

  // --- Step B: durable suspend until an external approval event arrives ---
  const approval = await ctx.waitForEvent<{
    approved: boolean;
    approver: string;
  }>("wait-for-approval", input.approvalToken);

  if (!approval.approved) {
    throw new Error(`approval denied by ${approval.approver}`);
  }

  // --- Step C: flaky step, retried with backoff ---
  const finalizeAttempts = await ctx.step(
    "flaky-finalize",
    () => {
      finalizeCalls++;
      if (finalizeCalls < 3) {
        throw new Error(
          `transient finalize failure (attempt ${finalizeCalls})`,
        );
      }
      return finalizeCalls;
    },
    { maxAttempts: 5, baseDelayMs: 10, factor: 2, maxDelayMs: 200 },
  );

  return { counter, approval, finalizeAttempts, done: true };
};
