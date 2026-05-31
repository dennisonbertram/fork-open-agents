// Durable workflow engine.
//
// Programming model (mirrors the Vercel Workflow DevKit `"use workflow"` /
// `"use step"` directives, but explicit so the durability is inspectable):
//
//   - A workflow is an async function that receives a `ctx`.
//   - `ctx.step(key, fn, retry?)` runs durable work. The RESULT is checkpointed.
//     On a resumed run, if the step is already completed in the log, `fn` is NOT
//     called — the recorded result is returned. This is replay, not re-run.
//   - `ctx.sleep(key, ms)` suspends durably until a wall-clock deadline.
//   - `ctx.waitForEvent(key, token)` suspends until an external actor delivers
//     `token`. The delivered payload is returned on resume.
//
// Suspension is implemented by THROWING a `Suspend` sentinel out of the
// workflow function. The driver catches it, leaves the run in a suspended
// state in the store, and returns. Re-running the same workflow function
// against the same store replays all completed steps, then either resumes
// (if the timer fired / event arrived) or suspends again. This is exactly how
// a durable runtime re-invokes a function after a teardown: same code, same
// persisted log, deterministic replay up to the new frontier.

import { Suspend } from "./signals";
import { StepFailedError } from "./step-failed-error";
import { WorkflowStore } from "./store";
import { DEFAULT_RETRY, type RetryPolicy } from "./types";

export { StepFailedError } from "./step-failed-error";

export type RunOutcome =
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string }
  | { status: "suspended_sleep"; stepKey: string; wakeAt: string }
  | { status: "suspended_event"; stepKey: string; token: string };

export type WorkflowContext = {
  runId: string;
  step<T>(
    key: string,
    fn: () => Promise<T> | T,
    retry?: RetryPolicy,
  ): Promise<T>;
  sleep(key: string, ms: number): Promise<void>;
  waitForEvent<T = unknown>(key: string, token: string): Promise<T>;
  // Test hook so the eval can crash the process at a precise point.
  onAfterStep?: (key: string) => void | Promise<void>;
};

export type WorkflowFn<I, O> = (input: I, ctx: WorkflowContext) => Promise<O>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WorkflowEngine {
  constructor(private store: WorkflowStore) {}

  // Run (or resume) a workflow to its next suspend point or terminal state.
  // Calling this repeatedly against the same store + runId drives the workflow
  // forward across crashes; each call replays the persisted log first.
  async run<I, O>(
    workflowName: string,
    runId: string,
    workflowFn: WorkflowFn<I, O>,
    input: I,
    hooks?: { onAfterStep?: (key: string) => void | Promise<void> },
  ): Promise<RunOutcome> {
    const existing = this.store.getRun(runId);
    if (!existing) {
      this.store.createRun(runId, workflowName, input);
    } else if (
      existing.status === "completed" ||
      existing.status === "failed"
    ) {
      // Already terminal — return the persisted outcome without re-running.
      return existing.status === "completed"
        ? { status: "completed", result: safeParse(existing.resultJson) }
        : { status: "failed", error: existing.errorMessage ?? "unknown" };
    } else {
      this.store.setRunStatus(runId, "running");
    }

    const resolvedInput: I =
      existing != null ? (safeParse(existing.inputJson) as I) : input;

    let ordinal = 0;
    const nextOrdinal = () => ordinal++;

    const ctx: WorkflowContext = {
      runId,
      onAfterStep: hooks?.onAfterStep,
      step: async <T>(
        key: string,
        fn: () => Promise<T> | T,
        retry: RetryPolicy = DEFAULT_RETRY,
      ): Promise<T> => {
        const ord = nextOrdinal();
        const recorded = this.store.getStep(runId, key);
        if (recorded?.status === "completed") {
          // REPLAY: do not re-execute. Return the checkpointed result.
          return safeParse(recorded.resultJson) as T;
        }

        const startedAt = new Date().toISOString();
        let attempt = recorded?.attempts ?? 0;
        let lastError: unknown;
        while (attempt < retry.maxAttempts) {
          attempt++;
          try {
            const result = await fn();
            this.store.recordStep({
              runId,
              stepKey: key,
              ordinal: ord,
              status: "completed",
              result,
              attempts: attempt,
              startedAt,
            });
            await ctx.onAfterStep?.(key);
            return result;
          } catch (error) {
            lastError = error;
            // Persist the failed attempt count so retries survive a crash too.
            this.store.recordStep({
              runId,
              stepKey: key,
              ordinal: ord,
              status: "failed",
              errorMessage: errMsg(error),
              attempts: attempt,
              startedAt,
            });
            if (attempt >= retry.maxAttempts) {
              break;
            }
            const delay = Math.min(
              retry.baseDelayMs * retry.factor ** (attempt - 1),
              retry.maxDelayMs,
            );
            await sleep(delay);
          }
        }
        throw new StepFailedError(key, attempt, errMsg(lastError));
      },

      sleep: async (key: string, ms: number): Promise<void> => {
        nextOrdinal();
        const existingSleep = this.store.getSleep(runId, key);
        if (existingSleep?.firedAt) {
          return; // already elapsed in a prior run — replay past it
        }
        const sleepRec =
          existingSleep ??
          this.store.createSleep(
            runId,
            key,
            new Date(Date.now() + ms).toISOString(),
          );
        if (Date.now() >= Date.parse(sleepRec.wakeAt)) {
          this.store.fireSleep(runId, key);
          return;
        }
        throw new Suspend("sleep", key);
      },

      waitForEvent: async <T>(key: string, token: string): Promise<T> => {
        nextOrdinal();
        const existingWaiter = this.store.getWaiter(runId, key);
        if (existingWaiter?.deliveredAt) {
          return safeParse(existingWaiter.payloadJson) as T; // event already arrived
        }
        if (!existingWaiter) {
          this.store.createWaiter(runId, key, token);
        }
        throw new Suspend("event", key);
      },
    };

    try {
      const result = await workflowFn(resolvedInput, ctx);
      this.store.setRunStatus(runId, "completed", { result });
      return { status: "completed", result };
    } catch (error) {
      if (error instanceof Suspend) {
        if (error.kind === "sleep") {
          const s = this.store.getSleep(runId, error.stepKey)!;
          this.store.setRunStatus(runId, "suspended_sleep");
          return {
            status: "suspended_sleep",
            stepKey: error.stepKey,
            wakeAt: s.wakeAt,
          };
        }
        const w = this.store.getWaiter(runId, error.stepKey)!;
        this.store.setRunStatus(runId, "suspended_event");
        return {
          status: "suspended_event",
          stepKey: error.stepKey,
          token: w.token,
        };
      }
      const message = errMsg(error);
      this.store.setRunStatus(runId, "failed", { errorMessage: message });
      return { status: "failed", error: message };
    }
  }
}

function safeParse(json: string | null): unknown {
  if (json == null) {
    return undefined;
  }
  return JSON.parse(json);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
