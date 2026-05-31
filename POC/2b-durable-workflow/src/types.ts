// Shared types for the durable workflow engine prototype.
//
// The engine models the three durability primitives that POC 2b must prove,
// mirroring the Vercel Workflow DevKit surface (`"use step"`, `sleep`,
// `createHook`/`createWebhook`) but with a locally-runnable, inspectable
// persistence backend:
//
//   - step   : a unit of work whose RESULT is checkpointed to the store. On
//              resume, a completed step is REPLAYED from the log (its recorded
//              result is returned) instead of being re-executed. This is the
//              load-bearing property — equivalent to the DevKit only retrying
//              failed steps and skipping completed ones.
//   - sleep  : a durable delay. The wake-at timestamp is persisted; the engine
//              can be torn down and re-instantiated and the sleep still expires
//              at the original wall-clock time (no compute consumed while idle).
//   - waitForEvent : a suspend point keyed by a token. The workflow parks until
//              an external actor delivers a payload for that token (the 1b
//              approval park, the 2c external event, or a 2a cron trigger).

export type RunStatus =
  | "running"
  | "suspended_sleep"
  | "suspended_event"
  | "completed"
  | "failed";

export type StepStatus = "completed" | "failed";

// One persisted, replayable record in the step log.
export type StepRecord = {
  runId: string;
  // Deterministic key: workflows must request steps in a stable order so a
  // resumed run lines up its replayed results with the original execution.
  // We key on an explicit caller-supplied id plus an ordinal to detect drift.
  stepKey: string;
  ordinal: number;
  status: StepStatus;
  // JSON-serialized result of the step (DevKit step results must be
  // serializable; we enforce the same constraint).
  resultJson: string | null;
  errorMessage: string | null;
  attempts: number;
  startedAt: string;
  finishedAt: string;
};

// A durable timer. `wakeAt` is absolute wall-clock; survives process death.
export type SleepRecord = {
  runId: string;
  stepKey: string;
  wakeAt: string;
  createdAt: string;
  firedAt: string | null;
};

// A suspend-for-event waiter. `payloadJson` is null until an external actor
// delivers the event for `token`.
export type EventWaiterRecord = {
  runId: string;
  stepKey: string;
  token: string;
  payloadJson: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type RunRecord = {
  runId: string;
  workflowName: string;
  status: RunStatus;
  inputJson: string;
  resultJson: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

// Retry policy for a single step. Mirrors DevKit `withRetry({ maxRetries })`
// plus an explicit exponential backoff schedule.
export type RetryPolicy = {
  maxAttempts: number; // total attempts incl. the first
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 50,
  factor: 2,
  maxDelayMs: 5_000,
};
