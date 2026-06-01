import { getRun, resumeHook } from "workflow/api";
import {
  getRunControl,
  updateRunControlStatus,
} from "@/lib/db/workflow-run-controls";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunControlStatus =
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "cancelling"
  | "cancelled";

export type RunControlCommand = "pause" | "resume" | "cancel";

export type RunControlErrorKind =
  | "run_control_unauthorized"
  | "run_control_not_found"
  | "run_control_illegal_transition"
  | "run_control_conflict"
  | "run_control_persist_failed";

export type RunControlResult =
  | { ok: true; state: RunControlStatus }
  | { ok: false; error: RunControlErrorKind };

// ---------------------------------------------------------------------------
// Pure transition table
// ---------------------------------------------------------------------------

/**
 * Returns true if the given command is legal from the given state.
 * PURE — no side effects, fully unit-testable.
 */
export function canTransition(
  from: RunControlStatus,
  command: RunControlCommand,
): boolean {
  switch (from) {
    case "running":
      return command === "pause" || command === "cancel";
    case "paused":
      return command === "resume" || command === "cancel";
    // In-flight transitioning states: only matching idempotent re-issue is
    // allowed (handled separately in applyRunControlCommand). No new
    // transitions from transitioning states.
    case "pausing":
    case "resuming":
    case "cancelling":
    case "cancelled":
      return false;
  }
}

/**
 * Determine target state for a legal transition.
 */
function targetState(command: RunControlCommand): RunControlStatus {
  switch (command) {
    case "pause":
      return "pausing";
    case "resume":
      return "resuming";
    case "cancel":
      return "cancelling";
  }
}

/**
 * Returns true if the given state is a "transitioning-to" state for the
 * given command (used for idempotency detection).
 */
function isIdempotentState(
  state: RunControlStatus,
  command: RunControlCommand,
): boolean {
  switch (command) {
    case "pause":
      return state === "pausing" || state === "paused";
    case "resume":
      return state === "resuming" || state === "running";
    case "cancel":
      return state === "cancelling" || state === "cancelled";
  }
}

// ---------------------------------------------------------------------------
// Structured event emission (best-effort, never throws)
// ---------------------------------------------------------------------------

type CommandEventFields = {
  userId: string;
  runId: string;
  command: RunControlCommand;
  idempotencyKey: string;
};

function emitCommandAccepted(
  fields: CommandEventFields & {
    fromState: RunControlStatus;
    toState: RunControlStatus;
  },
): void {
  try {
    console.log(
      JSON.stringify({
        level: "info",
        service: "workflow-steering",
        action: "workflow-control-command-accepted",
        ...fields,
      }),
    );
  } catch {
    // best-effort
  }
}

function emitCommandRejected(
  fields: CommandEventFields & {
    errorKind: RunControlErrorKind;
    currentState?: RunControlStatus;
  },
): void {
  try {
    console.warn(
      JSON.stringify({
        level: "warn",
        service: "workflow-steering",
        action: "workflow-control-command-rejected",
        ...fields,
      }),
    );
  } catch {
    // best-effort
  }
}

function emitCommandFailed(
  fields: CommandEventFields & { errorKind: RunControlErrorKind },
): void {
  try {
    console.error(
      JSON.stringify({
        level: "error",
        service: "workflow-steering",
        action: "workflow-control-command-failed",
        ...fields,
      }),
    );
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Primary command function
// ---------------------------------------------------------------------------

/**
 * Apply a run-control command. Never throws — all errors are returned as typed
 * RunControlResult values.
 *
 * Logic:
 * 1. Load the control row (→ not_found if missing).
 * 2. Check ownership (→ unauthorized if userId mismatch).
 * 3. Check idempotent re-issue (same command + same key in target/transitioning
 *    state → no-op, return current state).
 * 4. Check conflicting pending command (→ conflict if different command is
 *    already in-flight with a different idempotencyKey).
 * 5. Check canTransition (→ illegal_transition if not legal).
 * 6. CAS-persist the new state (UPDATE WHERE status=currentState).
 *    If 0 rows updated (concurrent transition won), re-read and re-classify.
 * 7. Perform the SDK side-effect (cancel or resumeHook).
 *    If the SDK throws, revert the row to the prior status (best-effort CAS
 *    revert) and return run_control_persist_failed.
 *
 * NOTE on error kind reuse: run_control_persist_failed covers both DB persist
 * failures (Step 6) and SDK side-effect failures (Step 7). The taxonomy is
 * fixed at 5 kinds per the issue spec; SDK failure is the closest match to a
 * "the state change could not be completed" error.
 */
export async function applyRunControlCommand(params: {
  runId: string;
  userId: string;
  command: RunControlCommand;
  idempotencyKey: string;
}): Promise<RunControlResult> {
  const { runId, userId, command, idempotencyKey } = params;

  // Step 1: Load control row
  let row: Awaited<ReturnType<typeof getRunControl>>;
  try {
    row = await getRunControl(runId);
  } catch {
    emitCommandFailed({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_persist_failed",
    });
    return { ok: false, error: "run_control_persist_failed" };
  }

  if (!row) {
    emitCommandRejected({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_not_found",
    });
    return { ok: false, error: "run_control_not_found" };
  }

  const currentState = row.status as RunControlStatus;

  // Step 2: Check ownership
  if (row.userId !== userId) {
    emitCommandRejected({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_unauthorized",
      currentState,
    });
    return { ok: false, error: "run_control_unauthorized" };
  }

  // Step 3: Idempotent re-issue check — same command + same idempotency key
  // when already in the target/transitioning state → no-op.
  if (
    row.idempotencyKey === idempotencyKey &&
    isIdempotentState(currentState, command)
  ) {
    return { ok: true, state: currentState };
  }

  // Step 4: Conflict detection — a different command is already pending
  // (current state is pausing or resuming, different idempotency key).
  // NOTE: cancelling is NOT checked here — any command on cancelling is an
  // illegal_transition (Step 5), not a conflict.
  if (
    (currentState === "pausing" || currentState === "resuming") &&
    row.idempotencyKey !== idempotencyKey
  ) {
    emitCommandRejected({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_conflict",
      currentState,
    });
    return { ok: false, error: "run_control_conflict" };
  }

  // Step 5: Legal transition check
  if (!canTransition(currentState, command)) {
    emitCommandRejected({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_illegal_transition",
      currentState,
    });
    return { ok: false, error: "run_control_illegal_transition" };
  }

  const newState = targetState(command);
  // Remember the prior state for potential revert after SDK side-effect.
  const priorState = currentState;

  // Step 6: CAS-persist the new state.
  // UPDATE WHERE status = currentState. If the row was concurrently
  // updated (another command won the race), 0 rows are updated → null.
  let updated: Awaited<ReturnType<typeof updateRunControlStatus>>;
  try {
    updated = await updateRunControlStatus(runId, {
      status: newState,
      pendingCommandKind: command,
      idempotencyKey,
      commandedBy: userId,
      commandedAt: new Date(),
      expectedFromStatus: currentState,
    });
  } catch {
    emitCommandFailed({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_persist_failed",
    });
    return { ok: false, error: "run_control_persist_failed" };
  }

  if (!updated) {
    // CAS missed: a concurrent transition already mutated the row.
    // Re-read to produce the correct outcome.
    let freshRow: Awaited<ReturnType<typeof getRunControl>>;
    try {
      freshRow = await getRunControl(runId);
    } catch {
      emitCommandFailed({
        userId,
        runId,
        command,
        idempotencyKey,
        errorKind: "run_control_persist_failed",
      });
      return { ok: false, error: "run_control_persist_failed" };
    }

    if (!freshRow) {
      return { ok: false, error: "run_control_not_found" };
    }

    const freshState = freshRow.status as RunControlStatus;

    // Idempotent: concurrent command moved us to the target state with same key
    if (
      freshRow.idempotencyKey === idempotencyKey &&
      isIdempotentState(freshState, command)
    ) {
      return { ok: true, state: freshState };
    }

    // Different command is now pending
    if (freshState === "pausing" || freshState === "resuming") {
      emitCommandRejected({
        userId,
        runId,
        command,
        idempotencyKey,
        errorKind: "run_control_conflict",
        currentState: freshState,
      });
      return { ok: false, error: "run_control_conflict" };
    }

    // Terminal or otherwise illegal
    emitCommandRejected({
      userId,
      runId,
      command,
      idempotencyKey,
      errorKind: "run_control_illegal_transition",
      currentState: freshState,
    });
    return { ok: false, error: "run_control_illegal_transition" };
  }

  emitCommandAccepted({
    userId,
    runId,
    command,
    idempotencyKey,
    fromState: priorState,
    toState: newState,
  });

  // Step 7: SDK side-effect.
  // On SDK failure: best-effort revert the row to the prior state, then return
  // run_control_persist_failed (the closest existing error kind for "state
  // change could not be completed"). The revert is itself best-effort: if it
  // also fails the row may remain in the transitional state, which is
  // observable and safer than silently returning ok:true.
  if (command === "cancel") {
    try {
      const run = getRun(runId);
      await run.cancel();
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "workflow-steering",
          action: "workflow-control-sdk-cancel-failed",
          userId,
          runId,
          command,
          idempotencyKey,
          error: String(err),
        }),
      );
      // Best-effort revert: WHERE status=newState (cancelling) → back to priorState
      try {
        await updateRunControlStatus(runId, {
          status: priorState,
          pendingCommandKind: null,
          expectedFromStatus: newState,
        });
      } catch {
        // Revert failed — row remains in transitional state (observable in logs)
      }
      return { ok: false, error: "run_control_persist_failed" };
    }
  } else if (command === "resume") {
    const hookToken = row.hookToken ?? `pause:${runId}`;
    try {
      await resumeHook(hookToken, { command: "resume" });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "workflow-steering",
          action: "workflow-control-sdk-resume-failed",
          userId,
          runId,
          command,
          idempotencyKey,
          hookToken,
          error: String(err),
        }),
      );
      // Best-effort revert: WHERE status=newState (resuming) → back to priorState
      try {
        await updateRunControlStatus(runId, {
          status: priorState,
          pendingCommandKind: null,
          expectedFromStatus: newState,
        });
      } catch {
        // Revert failed — row remains in transitional state (observable in logs)
      }
      return { ok: false, error: "run_control_persist_failed" };
    }
  }
  // pause: the workflow hook is already set up inside runAgentWorkflow;
  // no additional SDK call is needed here.

  return { ok: true, state: newState };
}
