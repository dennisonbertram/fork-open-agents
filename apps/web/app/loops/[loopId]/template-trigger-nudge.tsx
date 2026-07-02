"use client";

/**
 * template-trigger-nudge.tsx — post-create "Attach suggested trigger" nudge
 * (#765).
 *
 * After creating a loop from a template that has a suggestedTriggerSpec, the
 * create form appends suggestedTrigger* query params to the redirect target
 * (see suggested-trigger-query.ts). This component reads those params back
 * and offers a one-click "Attach suggested trigger: <humanized>" action that
 * calls POST /api/agent-loops/[loopId]/triggers (#762's API). Creating the
 * loop never auto-attaches the trigger — this is purely an opt-in nudge the
 * user can accept or dismiss.
 *
 * Renders nothing when no recognized suggested-trigger params are present,
 * or after the trigger has been attached or the nudge dismissed.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { humanizeSchedule } from "@/lib/background-agents/schedule-humanize";
import { getTriggerKindLabel } from "./loop-trigger-kind-labels";
import { decodeSuggestedTriggerParams } from "../suggested-trigger-query";

type TemplateTriggerNudgeProps = {
  loopId: string;
  searchParams: URLSearchParams;
};

function buildTriggerName(kind: string): string {
  return `Suggested ${getTriggerKindLabel(kind).toLowerCase()} trigger`;
}

export function TemplateTriggerNudge({
  loopId,
  searchParams,
}: TemplateTriggerNudgeProps) {
  const router = useRouter();
  const spec = decodeSuggestedTriggerParams(searchParams);
  const [dismissed, setDismissed] = useState(false);
  const [attaching, setAttaching] = useState(false);

  if (!spec || dismissed) {
    return null;
  }

  const humanized =
    spec.kind === "schedule.cron"
      ? humanizeSchedule(spec.schedule)
      : getTriggerKindLabel(spec.kind);

  async function handleAttach() {
    if (!spec) {
      return;
    }
    setAttaching(true);
    try {
      const body =
        spec.kind === "schedule.cron"
          ? {
              kind: "schedule.cron",
              name: buildTriggerName(spec.kind),
              schedule: spec.schedule,
            }
          : { kind: spec.kind, name: buildTriggerName(spec.kind) };

      const res = await fetch(`/api/agent-loops/${loopId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(errBody.message ?? "Failed to attach trigger.");
        return;
      }

      toast.success("Trigger attached.");
      setDismissed(true);
      // Drop the suggested-trigger query params now that the nudge is resolved.
      router.replace(`/loops/${loopId}/builder`);
    } catch {
      toast.error("Failed to attach trigger. Check your connection.");
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-4 py-3 text-sm">
      <p className="text-muted-foreground">
        This template works best with a trigger.{" "}
        <span className="font-medium text-foreground">{humanized}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={attaching}
          onClick={handleAttach}
        >
          {attaching ? "Attaching…" : `Attach suggested trigger: ${humanized}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
