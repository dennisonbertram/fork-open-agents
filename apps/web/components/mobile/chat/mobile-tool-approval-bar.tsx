"use client";

import { isToolUIPart } from "ai";
import { ShieldAlert } from "lucide-react";
import { extractRenderState, getToolName } from "@/app/lib/render-tool";
import type { WebAgentUIMessage } from "@/app/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PendingApproval {
  /** The approval ID passed to addToolApprovalResponse */
  id: string;
  /** Human-readable tool or action name to surface in the bar */
  toolName: string;
}

export interface MobileToolApprovalBarProps {
  /** The pending approval to display, or null when nothing is waiting */
  pending: PendingApproval | null;
  /** Called with the approval ID when the user taps Approve */
  onApprove: (id: string) => void;
  /** Called with the approval ID when the user taps Deny */
  onDeny: (id: string) => void;
}

/**
 * Pinned bottom bar that surfaces a single pending tool-approval request.
 *
 * Only renders when `pending` is non-null. Deny is destructive; Approve is
 * primary. Both buttons meet the >=44px touch-target requirement.
 */
export function MobileToolApprovalBar({
  pending,
  onApprove,
  onDeny,
}: MobileToolApprovalBarProps) {
  if (!pending) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t border-border bg-card px-4 pb-[max(env(safe-area-inset-bottom,0px),12px)] pt-3",
        "animate-in slide-in-from-bottom-2 duration-150",
      )}
      role="region"
      aria-label="Tool approval required"
    >
      {/* Label row */}
      <div className="flex items-start gap-2">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Approval needed</p>
          <p className="truncate text-xs text-muted-foreground">
            {pending.toolName}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          className="min-h-[44px] flex-1"
          onClick={() => onDeny(pending.id)}
          aria-label={`Deny ${pending.toolName}`}
        >
          Deny
        </Button>
        <Button
          variant="default"
          className="min-h-[44px] flex-1"
          onClick={() => onApprove(pending.id)}
          aria-label={`Approve ${pending.toolName}`}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}

/**
 * Scan the last assistant message's tool parts and return the first
 * approval-requested part, or null if none is waiting.
 *
 * Tool parts on the real runtime are AI SDK UI parts (`tool-bash`,
 * `tool-read`, …, or `dynamic-tool`) — never a `tool-invocation` type. We
 * detect them with `isToolUIPart` and reuse the shared `extractRenderState`
 * so the "approval requested" / "denied" logic matches the desktop renderer.
 */
export function findPendingApproval(
  messages: readonly WebAgentUIMessage[],
): PendingApproval | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (!isToolUIPart(part)) {
        continue;
      }

      const state = extractRenderState(part, null, false);
      if (state.approvalRequested && state.approvalId) {
        return {
          id: state.approvalId,
          toolName: getToolName(part),
        };
      }
    }

    // Only check the last assistant message
    break;
  }

  return null;
}
