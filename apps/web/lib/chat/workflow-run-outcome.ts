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
 * migration. `failed` keeps meaning "the workflow threw"; the four
 * `*_fuse`/`*_cap`/`max_steps`/`repeated_tool_failure` values are deliberate
 * stops (see `stopReason` in app/workflows/chat.ts, #1231), reusing that same
 * vocabulary rather than inventing a second one.
 *
 * #1247: three more values, widening this vocabulary a second time so soon
 * after #1241 — see the reader audit in lib/runs/status.ts and
 * lib/mcp-server/session-state.ts before changing this list again.
 *
 *   `truncated`               a step hit the provider's per-response
 *                             output-token ceiling (finishReason "length")
 *                             and stayed truncated after every continuation
 *                             the budget allowed — see
 *                             lib/chat/length-continuation-budget.ts.
 *   `awaiting_tool_approval`  the run paused for the user to approve or
 *                             supply tool input (shouldPauseForToolInteraction
 *                             in app/workflows/chat.ts). Not a failure: it is
 *                             the normal shape of a run that ends because the
 *                             next step needs the user, so it does NOT flip
 *                             the coarse `workflowStatus` used for session
 *                             events to "failed" — only this fine-grained
 *                             value changes.
 *   `ended_unexpectedly`      the step's finishReason was something other
 *                             than stop/tool-calls/length — currently
 *                             content-filter, error, or other, the only
 *                             other members of the AI SDK's `FinishReason`
 *                             union. These three share one value rather than
 *                             each getting its own name: they are rare
 *                             provider-side exits a caller cannot act on
 *                             differently from one another, and grouping
 *                             them keeps the vocabulary from growing for
 *                             every future FinishReason the SDK might add.
 */
export type WorkflowRunStatus =
  | "completed"
  | "aborted"
  | "failed"
  | "no_progress_fuse"
  | "no_sandbox_step_cap"
  | "max_steps"
  | "repeated_tool_failure"
  | "truncated"
  | "awaiting_tool_approval"
  | "ended_unexpectedly";

/**
 * Maps the raw stop signals app/workflows/chat.ts already tracks onto the
 * persisted, widened status vocabulary. A crash always wins over a stop
 * signal that happened to already be set (an unrelated exception thrown
 * after a fuse tripped must still be filed as `failed`, not
 * `no_progress_fuse`); an explicit user abort wins over both.
 *
 * The three #1247 flags are mutually exclusive with each other and with the
 * existing six in normal operation — only one `break` fires per run — but
 * the precedence below is still explicit and deterministic in case that ever
 * changes.
 */
export function deriveWorkflowRunOutcomeStatus(params: {
  crashed: boolean;
  wasAborted: boolean;
  stoppedForRepeatedToolFailure: boolean;
  exhaustedMaxSteps: boolean;
  headlessFuseTripped: boolean;
  headlessNoSandboxCapped: boolean;
  truncationBoundExhausted: boolean;
  awaitingToolApproval: boolean;
  endedUnexpectedly: boolean;
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
  if (params.truncationBoundExhausted) {
    return "truncated";
  }
  if (params.awaitingToolApproval) {
    return "awaiting_tool_approval";
  }
  if (params.endedUnexpectedly) {
    return "ended_unexpectedly";
  }
  return "completed";
}
