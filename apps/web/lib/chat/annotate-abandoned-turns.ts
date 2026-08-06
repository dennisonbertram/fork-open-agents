import type { WebAgentUIMessage } from "@/app/types";

/**
 * Fixed, non-user-authored marker appended to an abandoned assistant turn's
 * model-facing content. It never appears in the persisted message or the
 * user-visible transcript — only in the request sent to the model on the
 * next turn.
 */
export const ABANDONED_TURN_MARKER =
  "[SYSTEM NOTE: The request above was ABANDONED after a system error before any action was taken. Do NOT resume or continue it. Only act on it again if a later user message explicitly asks you to.]";

/**
 * Flag assistant turns that recorded `metadata.abandoned = true` so the
 * model sees an explicit note that the preceding user request was never
 * executed.
 *
 * A turn that fails fatally before producing any output persists its error
 * text as the assistant's only reply, with `metadata.abandoned = true` set
 * at the throw site in `chat.ts`. Without this transform, the next user
 * message — even an unrelated greeting — reads to the model as license to
 * silently resume the abandoned request, because nothing in the converted
 * conversation says it never ran (issue #1133).
 *
 * Only assistant turns are touched: new user input, explicit retry or not,
 * is always passed through unchanged.
 *
 * Returns the original array unchanged when there is nothing to annotate.
 */
export function annotateAbandonedTurns(
  messages: WebAgentUIMessage[],
): WebAgentUIMessage[] {
  let changed = false;

  const annotated = messages.map((message) => {
    if (message.role !== "assistant") return message;
    if (message.metadata?.abandoned !== true) return message;

    changed = true;
    return {
      ...message,
      parts: [
        ...message.parts,
        { type: "text" as const, text: ABANDONED_TURN_MARKER },
      ],
    };
  });

  return changed ? annotated : messages;
}
