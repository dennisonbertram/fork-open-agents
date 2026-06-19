"use client";

import { Ban, RefreshCw, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { WorkflowRunItem } from "@/lib/github/actions-manager/runs";

export type RunActionsMenuProps = {
  run: WorkflowRunItem;
  owner: string;
  repo: string;
  canWrite: boolean;
  onAction: () => void;
};

export function RunActionsMenu({
  run,
  owner,
  repo,
  canWrite,
  onAction,
}: RunActionsMenuProps) {
  const isInFlight = [
    "queued",
    "in_progress",
    "requested",
    "waiting",
    "pending",
  ].includes(run.status ?? "");
  const hasFailed = run.conclusion === "failure";

  async function handleRerun(onlyFailed: boolean) {
    try {
      const url = `/api/github/repos/${owner}/${repo}/actions/runs/${run.id}/rerun${onlyFailed ? "?onlyFailed=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Failed to re-run",
        );
      }
      toast.success(
        onlyFailed
          ? `Re-running failed jobs for #${run.runNumber}`
          : `Re-running #${run.runNumber}`,
      );
      onAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to re-run");
    }
  }

  async function handleCancel() {
    try {
      const url = `/api/github/repos/${owner}/${repo}/actions/runs/${run.id}/cancel`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Failed to cancel",
        );
      }
      toast.success(`Cancelling #${run.runNumber}`);
      onAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
    }
  }

  const writeDisabled = !canWrite;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Actions for run #${run.runNumber}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => handleRerun(false)}
          disabled={writeDisabled}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Re-run all jobs
        </DropdownMenuItem>
        {hasFailed && (
          <DropdownMenuItem
            onClick={() => handleRerun(true)}
            disabled={writeDisabled}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-run failed jobs
          </DropdownMenuItem>
        )}
        {isInFlight && (
          <DropdownMenuItem onClick={handleCancel} disabled={writeDisabled}>
            <Ban className="mr-2 h-4 w-4" />
            Cancel run
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
