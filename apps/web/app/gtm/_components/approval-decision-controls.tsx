"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Decision = "approved" | "denied";

export function ApprovalDecisionControls({
  approvalId,
}: {
  approvalId: string;
}) {
  const [status, setStatus] = useState<Decision | "pending">("pending");
  const [submitting, setSubmitting] = useState<Decision | null>(null);

  async function decide(decision: Decision) {
    setSubmitting(decision);
    try {
      const response = await fetch(`/api/gtm/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        throw new Error("approval decision failed");
      }
      setStatus(decision);
      toast.success(`Approval ${decision}`);
    } catch {
      toast.error("Failed to update approval");
    } finally {
      setSubmitting(null);
    }
  }

  if (status !== "pending") {
    return (
      <div className="text-xs font-medium text-muted-foreground">{status}</div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void decide("approved")}
        disabled={submitting !== null}
      >
        {submitting === "approved" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void decide("denied")}
        disabled={submitting !== null}
      >
        {submitting === "denied" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        Deny
      </Button>
    </div>
  );
}
