import { getRun } from "workflow/api";
import { compareAndSetChatActiveStreamId } from "@/lib/db/sessions";

export type StopChatRunInput = {
  chatId: string;
  activeStreamId: string | null;
};

export type StopChatRunResult = {
  stopped: boolean;
  workflowRunId: string | null;
};

/**
 * Whether a cancel failure means the run does not exist, as opposed to the
 * runtime being briefly unreachable.
 *
 * `cancelRun` in @workflow/core wraps the underlying failure in a plain Error
 * with the original on `cause`, and `WorkflowRunNotFoundError.is()` matches on
 * `name` without walking that chain — so the chain is walked here. Anything
 * this cannot positively identify as not-found is treated as live, which is
 * the safe direction: the caller gets an error rather than a false "nothing
 * was running".
 */
function isRunNotFoundError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.name === "WorkflowRunNotFoundError") {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Cancels a chat's live workflow run, then clears `active_stream_id` via
 * compare-and-set so a newer racing run's slot isn't clobbered.
 *
 * Idempotent: no active stream resolves `{ stopped: false, workflowRunId:
 * null }` rather than throwing. A *live* run must never resolve
 * `stopped: false` — a cancel failure propagates as a thrown error instead
 * of being swallowed into a false "nothing happened" result.
 */
export async function stopChatRun(
  input: StopChatRunInput,
): Promise<StopChatRunResult> {
  const { chatId, activeStreamId } = input;

  if (!activeStreamId) {
    return { stopped: false, workflowRunId: null };
  }

  try {
    const run = getRun(activeStreamId);
    await run.cancel();
  } catch (error) {
    if (!isRunNotFoundError(error)) {
      console.error(
        `[workflow] Failed to cancel workflow run for chat ${chatId}:`,
        error,
      );
      throw error;
    }
    // The runtime has no such run: the slot is stale, not live. Clear it so
    // the next turn is not blocked by it, and report the honest result.
    // Everything else — including a transient lookup failure — must keep
    // propagating: answering "nothing was running" while a billed agent keeps
    // working is how a caller ends up starting a second one alongside it.
    console.warn(
      `[workflow] Cleared a stale active_stream_id for chat ${chatId}: the workflow run no longer exists`,
    );
    await compareAndSetChatActiveStreamId(chatId, activeStreamId, null).catch(
      (err: unknown) => {
        console.error(
          `[workflow] Failed to clear stale activeStreamId for chat ${chatId}:`,
          err,
        );
      },
    );
    return { stopped: false, workflowRunId: null };
  }

  // Clear activeStreamId immediately so a follow-up prompt does not
  // reconnect to the cancelled (but not yet terminal) workflow.
  // Uses CAS to avoid clobbering a newer workflow that raced in.
  await compareAndSetChatActiveStreamId(chatId, activeStreamId, null).catch(
    (err: unknown) => {
      console.error(
        `[workflow] Failed to clear activeStreamId for chat ${chatId}:`,
        err,
      );
    },
  );

  return { stopped: true, workflowRunId: activeStreamId };
}
