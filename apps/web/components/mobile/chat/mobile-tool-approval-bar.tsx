"use client";

import { ShieldAlert } from "lucide-react";
import type { PendingApproval } from "@/app/lib/pending-tool-approvals";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
