// #1241: this is a pure mapping function with no database dependency, kept
// deliberately free of any `lib/db/` import so it is safe to use from
// app/workflows/chat.ts, which runs inside the workflow VM.
//
// NOTE: do NOT import `lib/db/workflow-runs` (or anything else under
// `lib/db/`) into this file. That module transitively pulls in `postgres`
// and `nanoid`, both of which depend on Node.js modules the workflow VM
// build rejects — see the identical warning on
// app/api/chat/_lib/persist-tool-results.ts.

/**
 * #1241: widened from ["completed", "aborted", "failed"] — see the schema
 * comment on `workflowRuns.status` (lib/db/schema.ts) for why this needed no
 * migration. `failed` keeps meaning "the workflow threw"; the four new
 * values are deliberate stops (see `stopReason` in app/workflows/chat.ts,
 * #1231), reusing that same vocabulary rather than inventing a second one.
 */
export type WorkflowRunStatus =
  | "completed"
  | "aborted"
  | "failed"
  | "no_progress_fuse"
  | "no_sandbox_step_cap"
  | "max_steps"
  | "repeated_tool_failure";

/**
 * Maps the raw stop signals app/workflows/chat.ts already tracks onto the
 * persisted, widened status vocabulary. A crash always wins over a stop
 * signal that happened to already be set (an unrelated exception thrown
 * after a fuse tripped must still be filed as `failed`, not
 * `no_progress_fuse`); an explicit user abort wins over both.
 */
export function deriveWorkflowRunOutcomeStatus(params: {
  crashed: boolean;
  wasAborted: boolean;
  stoppedForRepeatedToolFailure: boolean;
  exhaustedMaxSteps: boolean;
  headlessFuseTripped: boolean;
  headlessNoSandboxCapped: boolean;
}): WorkflowRunStatus {
  if (params.crashed) {
    return params.wasAborted ? "aborted" : "failed";
  }
  if (params.wasAborted) {
    return "aborted";
  }
  if (params.stoppedForRepeatedToolFailure) {
    return "repeated_tool_failure";
  }
  if (params.exhaustedMaxSteps) {
    return "max_steps";
  }
  if (params.headlessFuseTripped) {
    return "no_progress_fuse";
  }
  if (params.headlessNoSandboxCapped) {
    return "no_sandbox_step_cap";
  }
  return "completed";
}
