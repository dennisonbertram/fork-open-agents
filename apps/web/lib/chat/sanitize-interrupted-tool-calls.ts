import { isToolUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";

type UIPart = WebAgentUIMessage["parts"][number];

/**
 * Tool UI states that carry a result. A tool call in any other state has no
 * paired tool-result and, if sent to the model provider, produces a
 * "No tool output found for function call …" rejection.
 */
const TERMINAL_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

const INTERRUPTED_TOOL_ERROR =
  "This tool call did not complete before the conversation continued. Treat it as failed; retry it if the result is still needed.";

function isTerminalToolPart(part: UIPart): boolean {
  if (!isToolUIPart(part)) return true;
  return TERMINAL_TOOL_STATES.has(part.state);
}

/**
 * Rebuild an incomplete tool part as a terminal `output-error` so message
 * conversion emits a clean tool-call + tool-result pair. Drops `approval` and
 * any stale `output` so no dangling approval request/response is produced.
 */
function toInterruptedErrorPart(part: UIPart): UIPart {
  const source = part as Record<string, unknown>;
  const rebuilt: Record<string, unknown> = {
    type: source.type,
    toolCallId: source.toolCallId,
    state: "output-error",
    errorText: INTERRUPTED_TOOL_ERROR,
  };
  if ("input" in source) rebuilt.input = source.input;
  if ("rawInput" in source) rebuilt.rawInput = source.rawInput;
  if ("toolName" in source) rebuilt.toolName = source.toolName;
  if ("callProviderMetadata" in source) {
    rebuilt.callProviderMetadata = source.callProviderMetadata;
  }
  return rebuilt as unknown as UIPart;
}

/**
 * Neutralize tool calls that were interrupted before producing a result.
 *
 * The model provider requires every assistant tool-call to be paired with a
 * tool-result. A tool call that needs approval (e.g. `web_fetch`) can be left
 * in `approval-responded` with no output when the run dies mid-execution. If a
 * later user turn is then appended, the conversation has moved past the call
 * and the next inference request serializes an orphaned tool-call, which the
 * provider rejects — permanently wedging the chat.
 *
 * Only messages the conversation has already moved past are sanitized. The
 * trailing message is left untouched: a pending approval there is a legitimate
 * HITL resume that `streamText` is about to execute, and rewriting it would
 * break tool execution.
 *
 * Returns the original array/messages unchanged when there is nothing to fix.
 */
export function sanitizeInterruptedToolCalls(
  messages: WebAgentUIMessage[],
): WebAgentUIMessage[] {
  if (messages.length < 2) return messages;
  const lastIndex = messages.length - 1;

  let arrayChanged = false;
  const sanitized = messages.map((message, index) => {
    // Leave the trailing message alone so a pending approval can still resume.
    if (index === lastIndex) return message;
    if (message.role !== "assistant") return message;
    if (message.parts.every(isTerminalToolPart)) return message;

    arrayChanged = true;
    return {
      ...message,
      parts: message.parts.map((part) =>
        isTerminalToolPart(part) ? part : toInterruptedErrorPart(part),
      ),
    };
  });

  return arrayChanged ? sanitized : messages;
}
