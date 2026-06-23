"use client";

import { Button } from "@/components/ui/button";

export type ApprovalButtonsProps = {
  approvalId: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
  onApproveAllForSession?: (id: string) => void;
};

export function ApprovalButtons({
  approvalId,
  onApprove,
  onDeny,
  onApproveAllForSession,
}: ApprovalButtonsProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 pl-5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
        onClick={() => onApprove?.(approvalId)}
      >
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
        onClick={() => onDeny?.(approvalId)}
      >
        Deny
      </Button>
      {onApproveAllForSession && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-yellow-600 text-yellow-600 hover:bg-yellow-600 hover:text-white"
          onClick={() => onApproveAllForSession(approvalId)}
          aria-label="Allow all tool calls for this session"
        >
          Allow all this session
        </Button>
      )}
    </div>
  );
}
