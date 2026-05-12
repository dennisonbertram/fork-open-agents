"use client";

import { Check, Loader2, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { VerifiedBuildRunJson } from "./hooks/use-verified-build-run";

async function postRunAction(runId: string, action: string, body: unknown) {
  const response = await fetch(`/api/harness/runs/${runId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("Verified Build action failed");
  }
}

export function VerifiedBuildApprovals({ run }: { run: VerifiedBuildRunJson }) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const approvalPending =
    run.planApprovalState === "pending" && run.pendingApprovalKind;

  const perform = async (action: string, body: unknown) => {
    setPendingAction(action);
    try {
      await postRunAction(run.id, action, body);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-2 px-3 py-3">
      {approvalPending && (
        <Button
          size="sm"
          className="h-7 w-full gap-1.5 text-xs"
          disabled={pendingAction !== null}
          onClick={() =>
            void perform("approve", {
              kind: run.pendingApprovalKind,
              approved: true,
            })
          }
        >
          {pendingAction === "approve" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Approve plan
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={pendingAction !== null || run.status === "completed"}
          onClick={() => void perform("cancel", { reason: "user_requested" })}
        >
          {pendingAction === "cancel" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Square className="h-3 w-3 fill-current" />
          )}
          Cancel
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={pendingAction !== null || run.status !== "failed"}
          onClick={() => void perform("repair", { approvalKind: "repair" })}
        >
          {pendingAction === "repair" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Repair
        </Button>
      </div>
    </div>
  );
}
