"use client";

import { Ban, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ActionsManagerReadinessVerdict } from "@/lib/github/actions-manager/readiness";
import type { WorkflowRunItem } from "@/lib/github/actions-manager/runs";

type RunAction = "rerun" | "rerun_failed" | "cancel";

type RunActionsMenuProps = {
  baseUrl: string;
  run: WorkflowRunItem;
  writeReadiness: ActionsManagerReadinessVerdict;
  onMutated: () => Promise<void> | void;
};

const cancellableStatuses = new Set([
  "queued",
  "in_progress",
  "requested",
  "waiting",
  "pending",
]);

function mutationErrorCopy(errorKind: string | undefined): string {
  if (errorKind === "github_rate_limited") {
    return "GitHub is rate-limiting requests - try again shortly.";
  }
  if (errorKind === "app_no_actions_permission") {
    return "Action needed - re-authorize the GitHub App to manage Actions.";
  }
  if (errorKind === "run_not_cancellable") {
    return "GitHub could not cancel this run.";
  }
  return "GitHub could not complete that action.";
}

async function postJson(url: string) {
  const response = await fetch(url, { method: "POST" });
  const body = (await response.json()) as { errorKind?: string };
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      body,
      status: response.status,
    });
  }
  return body;
}

export function RunActionsMenu({
  baseUrl,
  run,
  writeReadiness,
  onMutated,
}: RunActionsMenuProps) {
  const [pendingAction, setPendingAction] = React.useState<RunAction | null>(
    null,
  );
  const canWrite = writeReadiness.status === "ready";
  const disabledReason =
    writeReadiness.subtext ??
    "Action needed - re-authorize the GitHub App to manage Actions.";
  const showRerunFailed = run.conclusion === "failure";
  const showCancel = cancellableStatuses.has(run.status);

  const submit = async (action: RunAction) => {
    setPendingAction(action);
    try {
      if (action === "cancel") {
        await postJson(`${baseUrl}/runs/${run.id}/cancel`);
        toast(`Cancelling #${run.runNumber}`);
      } else {
        const onlyFailed = action === "rerun_failed" ? "?onlyFailed=true" : "";
        await postJson(`${baseUrl}/runs/${run.id}/rerun${onlyFailed}`);
        toast(
          action === "rerun_failed"
            ? `Re-running failed jobs for #${run.runNumber}`
            : `Re-running all jobs for #${run.runNumber}`,
        );
      }
      await onMutated();
    } catch (error) {
      const errorKind =
        error && typeof error === "object"
          ? (error as { body?: { errorKind?: string } }).body?.errorKind
          : undefined;
      toast.error(mutationErrorCopy(errorKind));
    } finally {
      setPendingAction(null);
    }
  };

  const trigger = (
    <Button
      aria-label={`Actions for run #${run.runNumber}`}
      disabled={!canWrite}
      size="icon"
      type="button"
      variant="ghost"
    >
      {pendingAction ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MoreHorizontal className="h-4 w-4" />
      )}
    </Button>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            {canWrite ? (
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            ) : (
              trigger
            )}
          </span>
        </TooltipTrigger>
        {!canWrite ? <TooltipContent>{disabledReason}</TooltipContent> : null}
      </Tooltip>
      <DropdownMenuContent align="end">
        {!canWrite ? (
          <>
            <DropdownMenuLabel className="max-w-56 text-muted-foreground text-xs">
              {disabledReason}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={!canWrite || pendingAction !== null}
          onSelect={(event) => {
            event.preventDefault();
            void submit("rerun");
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Re-run all jobs
        </DropdownMenuItem>
        {showRerunFailed ? (
          <DropdownMenuItem
            disabled={!canWrite || pendingAction !== null}
            onSelect={(event) => {
              event.preventDefault();
              void submit("rerun_failed");
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Re-run failed jobs
          </DropdownMenuItem>
        ) : null}
        {showCancel ? (
          <DropdownMenuItem
            disabled={!canWrite || pendingAction !== null}
            onSelect={(event) => {
              event.preventDefault();
              void submit("cancel");
            }}
            variant="destructive"
          >
            <Ban className="h-4 w-4" />
            Cancel run #{run.runNumber}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
