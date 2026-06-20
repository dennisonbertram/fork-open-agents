import type { ModelMessage } from "ai";

/**
 * Reason attached to synthetic `execution-denied` tool results produced when an
 * unattended agent loop moves past a tool call that never received a result.
 */
export const UNATTENDED_DENIED_REASON =
  "This tool call required approval, which is unavailable in an unattended " +
  "agent run. It was not executed; treat it as failed and continue without it.";

type AssistantPart = { type: string; toolCallId?: string } & Record<
  string,
  unknown
>;

function isToolCallPart(part: AssistantPart): boolean {
  return part.type === "tool-call" && typeof part.toolCallId === "string";
}

function isApprovalRequestPart(part: AssistantPart): boolean {
  return (
    part.type === "tool-approval-request" && typeof part.toolCallId === "string"
  );
}

/**
 * Collect every toolCallId that already has a paired tool-result anywhere in the
 * conversation. The model provider only requires that each tool call has *a*
 * result; in the unattended executor loop results are always appended adjacent
 * to their call, so presence-anywhere is a safe completeness check.
 */
function collectResolvedToolCallIds(messages: ModelMessage[]): Set<string> {
  const resolved = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content as AssistantPart[]) {
      if (part.type === "tool-result" && typeof part.toolCallId === "string") {
        resolved.add(part.toolCallId);
      }
    }
  }
  return resolved;
}

function deniedResultPart(toolCallId: string, toolName: string) {
  return {
    type: "tool-result" as const,
    toolCallId,
    toolName,
    output: {
      type: "execution-denied" as const,
      reason: UNATTENDED_DENIED_REASON,
    },
  };
}

/**
 * Make an accumulated `ModelMessage[]` provider-valid for an unattended agent
 * loop.
 *
 * Anthropic (and other providers) reject any request where an assistant
 * `tool-call` block is not paired with a `tool-result`. In an unattended run an
 * approval-gated tool (web_fetch, or a dangerous/sensitive `bash`/`read`/`write`
 * call) produces an assistant tool-call with no result because there is no
 * human to approve it. Re-sending that history wedges the run with
 * "Tool result is missing for tool call …".
 *
 * For every assistant tool-call without a result, this:
 *   1. appends a synthetic `execution-denied` tool-result immediately after the
 *      assistant message (correct provider ordering), and
 *   2. strips the orphan `tool-approval-request` part so the SDK does not try to
 *      re-open the approval flow.
 *
 * The denied result preserves the security boundary — the gated action never
 * runs — while keeping the conversation valid so the loop can continue. Returns
 * the original array unchanged when there is nothing to fix.
 */
export function sanitizeUnattendedToolCalls(
  messages: ModelMessage[],
): ModelMessage[] {
  const resolved = collectResolvedToolCallIds(messages);
  let changed = false;
  const output: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      output.push(message);
      continue;
    }

    const parts = message.content as AssistantPart[];
    const dangling: Array<{ toolCallId: string; toolName: string }> = [];
    for (const part of parts) {
      if (isToolCallPart(part) && !resolved.has(part.toolCallId as string)) {
        dangling.push({
          toolCallId: part.toolCallId as string,
          toolName:
            typeof part.toolName === "string" ? part.toolName : "unknown",
        });
      }
    }

    if (dangling.length === 0) {
      output.push(message);
      continue;
    }

    changed = true;
    const danglingIds = new Set(dangling.map((d) => d.toolCallId));

    // Strip orphan approval-requests for the calls we are about to deny.
    const cleanedParts = parts.filter(
      (part) =>
        !(
          isApprovalRequestPart(part) &&
          danglingIds.has(part.toolCallId as string)
        ),
    );
    output.push({
      ...message,
      content: cleanedParts,
    } as ModelMessage);

    output.push({
      role: "tool",
      content: dangling.map((d) => deniedResultPart(d.toolCallId, d.toolName)),
    } as ModelMessage);
  }

  return changed ? output : messages;
}
