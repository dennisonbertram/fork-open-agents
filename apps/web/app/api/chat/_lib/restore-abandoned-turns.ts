import type { WebAgentUIMessage } from "@/app/types";
import { getAbandonedAssistantMessageIds } from "@/lib/db/sessions";

/**
 * Re-derive `metadata.abandoned` (issue #1133) from persisted history before a
 * chat turn is handed to the workflow.
 *
 * The workflow sets the flag on the assistant message it persists, but the
 * live stream carries only text chunks — no updated metadata. A client that
 * never reloads therefore holds a copy of the failed turn without the flag and
 * posts that copy back on the next message, so `annotateAbandonedTurns` sees
 * nothing and the abandoned request is silently resumed. That is exactly the
 * production scenario in #1133: the user kept typing in the same open chat.
 *
 * The persisted row is the authority. The flag is only ever written
 * server-side, so re-reading it here means a stale — or hand-edited — client
 * copy cannot clear it. Matching is by message id, which is stable: the
 * workflow streams `{ type: "start", messageId }` with the same id it later
 * persists.
 *
 * Returns the original array when there is nothing to restore, so the common
 * path allocates nothing and does not query.
 */
export async function restoreAbandonedTurnFlags(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<WebAgentUIMessage[]> {
  const hasUnflaggedAssistantTurn = messages.some(
    (message) =>
      message.role === "assistant" && message.metadata?.abandoned !== true,
  );
  if (!hasUnflaggedAssistantTurn) {
    return messages;
  }

  let abandonedIds: string[];
  try {
    abandonedIds = await getAbandonedAssistantMessageIds(chatId);
  } catch (error) {
    // Best-effort: a lookup failure must not block the turn. Worst case the
    // pre-fix behavior applies for this one turn.
    console.error(
      "Failed to load abandoned assistant message ids for chat",
      chatId,
      error,
    );
    return messages;
  }

  if (abandonedIds.length === 0) {
    return messages;
  }

  const abandoned = new Set(abandonedIds);
  let changed = false;

  const restored = messages.map((message) => {
    if (message.role !== "assistant") return message;
    if (message.metadata?.abandoned === true) return message;
    if (!abandoned.has(message.id)) return message;

    changed = true;
    return {
      ...message,
      metadata: { ...message.metadata, abandoned: true },
    };
  });

  return changed ? restored : messages;
}
