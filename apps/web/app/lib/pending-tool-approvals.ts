import { isToolUIPart } from "ai";
import type { WebAgentUIMessage, WebAgentUIMessagePart } from "../types";
import { extractRenderState, getToolName } from "./render-tool";

export interface PendingApproval {
  /** The approval ID passed to addToolApprovalResponse. */
  id: string;
  /** Human-readable tool or action name to surface in the UI. */
  toolName: string;
}

function collectPendingApprovalsFromParts(
  parts: readonly WebAgentUIMessagePart[],
) {
  const pending: PendingApproval[] = [];

  for (const part of parts) {
    if (!isToolUIPart(part)) {
      continue;
    }

    const state = extractRenderState(part, null, false);
    if (state.approvalRequested && state.approvalId) {
      pending.push({
        id: state.approvalId,
        toolName: getToolName(part),
      });
    }
  }

  return pending;
}

/**
 * Return every currently pending tool approval across visible assistant
 * messages. IDs are de-duplicated so auto-approve effects can be idempotent.
 */
export function collectPendingApprovals(
  messages: readonly WebAgentUIMessage[],
) {
  const pending: PendingApproval[] = [];
  const seenIds = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const approval of collectPendingApprovalsFromParts(message.parts)) {
      if (seenIds.has(approval.id)) {
        continue;
      }
      seenIds.add(approval.id);
      pending.push(approval);
    }
  }

  return pending;
}

/**
 * Scan the last assistant message's tool parts and return the first pending
 * approval, preserving the existing mobile bottom-bar behavior.
 */
export function findPendingApproval(
  messages: readonly WebAgentUIMessage[],
): PendingApproval | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }

    return collectPendingApprovalsFromParts(message.parts)[0] ?? null;
  }

  return null;
}
