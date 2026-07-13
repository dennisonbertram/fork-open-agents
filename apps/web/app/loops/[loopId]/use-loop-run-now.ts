"use client";

/**
 * use-loop-run-now.ts — shared "Run now" dispatch hook (#894).
 *
 * Extracted verbatim from loop-detail.tsx's handleRunNow so the loop-detail
 * page and the loop builder header dispatch runs identically: same
 * POST /api/agent-loops/:id/runs call, same 409 active_run / 502
 * typed-dispatch-failure (#763) / generic-error / success branches, same
 * toasts and navigation. Surface-specific bits (the inline active-run notice
 * vs. a toast, revalidating a runs SWR list) are delegated via callbacks so
 * this hook stays presentation-agnostic.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { StartAgentLoopRunResponse } from "@/app/api/agent-loops/types";
import { canonicalRunDetailUrl } from "@/lib/runs/detail-routes";

export const DISPATCH_FAILED_TOAST =
  "Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details.";

type UseLoopRunNowOptions = {
  loopId: string;
  surface?: "legacy" | "automation";
  onStart?: () => void;
  onError?: (message: string) => void;
  onActiveRun?: (activeRunId: string) => void;
  resolveActiveRunId?: () => string | undefined;
  onStarted?: (runId: string) => void;
};

export function useLoopRunNow({
  loopId,
  surface = "legacy",
  onStart,
  onError,
  onActiveRun,
  resolveActiveRunId,
  onStarted,
}: UseLoopRunNowOptions) {
  const router = useRouter();
  const [runningNow, setRunningNow] = useState(false);
  const runHref = (runId: string) =>
    surface === "automation"
      ? canonicalRunDetailUrl("agent_loop", runId)
      : `/loops/${loopId}/runs/${runId}`;

  async function runNow() {
    setRunningNow(true);
    onStart?.();
    const reportError = (message: string) => {
      onError?.(message);
      toast.error(message);
    };
    try {
      const res = await fetch(`/api/agent-loops/${loopId}/runs`, {
        method: "POST",
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          errorKind?: string;
          message?: string;
          activeRunId?: string;
        };
        if (body.errorKind === "active_run") {
          const activeId =
            body.activeRunId ?? resolveActiveRunId?.() ?? "unknown";
          onActiveRun?.(activeId);
          return;
        }
        reportError(body.message ?? "Cannot start run right now.");
        return;
      }

      if (res.status === 502) {
        // Issue #763 — no false success: the execution backend rejected the
        // dispatch. The run was created but is already marked failed —
        // surface the real state and point at the run page for details.
        const body = (await res.json().catch(() => ({}))) as {
          errorKind?: string;
          runId?: string;
        };
        reportError(DISPATCH_FAILED_TOAST);
        if (body.runId) {
          router.push(runHref(body.runId));
        }
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        reportError(body.message ?? "Failed to start run.");
        return;
      }

      const { runId } = (await res.json()) as StartAgentLoopRunResponse;
      toast.success("Run started");
      onStarted?.(runId);
      router.push(runHref(runId));
    } catch {
      reportError("Failed to start run.");
    } finally {
      setRunningNow(false);
    }
  }

  return { runNow, runningNow };
}
