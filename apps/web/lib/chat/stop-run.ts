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
    console.error(
      `[workflow] Failed to cancel workflow run for chat ${chatId}:`,
      error,
    );
    throw error;
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
