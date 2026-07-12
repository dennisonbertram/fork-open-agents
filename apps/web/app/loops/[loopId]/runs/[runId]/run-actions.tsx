"use client";

import { Loader2, Pause, Play, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getRunControlToastMessage } from "./run-control-toast-message";

/**
 * Toast copy for a typed dispatch failure (issue #763 — "no false success"),
 * defined in run-control-toast-message.ts (#767) and used by postControl()
 * below. Restated here verbatim (single line, spec-pinned):
 */
// Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details.

// ── Types ─────────────────────────────────────────────────────────────────────

type RunActionsProps = {
  runId: string;
  loopId: string | null;
  status: string;
  sourceAvailable?: boolean;
  /** Present when a previous "Run now" returned 409 active_run — render a notice */
  activeRunId?: string;
  onActionComplete?: () => void;
};

/**
 * Retry-eligible statuses (#767). The store only allows retrying a run whose
 * currentStepRunId is in a failed/stalled step (store.ts retryCurrentStep) —
 * completed and cancelled runs are always rejected, so Retry must not be
 * offered for them even though they're also "terminal".
 */
const RETRYABLE_STATUSES = new Set(["failed", "stalled"]);

const NON_TERMINAL_STATUSES = new Set(["queued", "running", "paused"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postControl(runId: string, action: string): Promise<void> {
  const res = await fetch(`/api/agent-loop-runs/${runId}/${action}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      errorKind?: string;
    };
    const message = getRunControlToastMessage(action, body);
    throw Object.assign(new Error(message), {
      status: res.status,
      errorKind: body.errorKind,
    });
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RunActions({
  runId,
  loopId,
  status,
  sourceAvailable = true,
  activeRunId,
  onActionComplete,
}: RunActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const isRetryable = RETRYABLE_STATUSES.has(status);
  const isNonTerminal = NON_TERMINAL_STATUSES.has(status);

  if (!sourceAvailable || loopId === null) return null;

  async function handleAction(action: string, label: string) {
    setLoading(action);
    try {
      await postControl(runId, action);
      toast.success(`${label} successful`);
      onActionComplete?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Failed to ${action}`;
      toast.error(message);
      // dispatch_failed means the server already marked the run failed;
      // refresh the run view since terminal statuses are not polled.
      if ((err as { errorKind?: string }).errorKind === "dispatch_failed") {
        onActionComplete?.();
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 409 active run notice */}
      {activeRunId && (
        <p className="w-full rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          A run is already active:{" "}
          <Link
            href={`/loops/${loopId}/runs/${activeRunId}`}
            className="font-mono underline"
          >
            {activeRunId}
          </Link>
          . Cancel it or wait for it to complete before starting a new run.
        </p>
      )}

      {/* Pause — running only */}
      {status === "running" && (
        <Button
          size="sm"
          variant="outline"
          disabled={loading !== null}
          onClick={() => handleAction("pause", "Pause")}
        >
          {loading === "pause" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Pause className="mr-1 h-3 w-3" />
          )}
          Pause
        </Button>
      )}

      {/* Resume — paused only */}
      {status === "paused" && (
        <Button
          size="sm"
          variant="outline"
          disabled={loading !== null}
          onClick={() => handleAction("resume", "Resume")}
        >
          {loading === "resume" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          Resume
        </Button>
      )}

      {/* Cancel — non-terminal runs with confirmation dialog */}
      {isNonTerminal && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={loading !== null}>
              <XCircle className="mr-1 h-3 w-3" />
              Cancel run
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel run?</DialogTitle>
              <DialogDescription>
                The current step will finish or be abandoned at its boundary.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Keep running</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  onClick={() => handleAction("cancel", "Cancel")}
                >
                  Cancel run
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Retry — failed/stalled runs only (store rejects completed/cancelled) */}
      {isRetryable && (
        <Button
          size="sm"
          variant="outline"
          disabled={loading !== null}
          onClick={() => handleAction("retry", "Retry")}
        >
          {loading === "retry" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Retry
        </Button>
      )}
    </div>
  );
}
