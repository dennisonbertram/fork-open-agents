"use client";

/**
 * loop-triggers-card.tsx — a real trigger manager for the loop detail page
 * (#762), replacing the old dead-end "Manage triggers in Background agents
 * settings" link.
 *
 * States: empty, list, add-form (schedule|event tabs via
 * LoopTriggerAddForm), saving, error (plain language + retry).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { humanizeSchedule } from "@/lib/background-agents/schedule-humanize";
import { StatusPill } from "./status-pill";
import { getTriggerKindLabel } from "./loop-trigger-kind-labels";
import { getTriggersInactiveWarning } from "./status-trigger-notice";
import {
  LoopTriggerAddForm,
  type NewTriggerInput,
} from "./loop-trigger-add-form";

export type LoopTriggerCardRow = {
  id: string;
  kind: string;
  status: string;
  conditions: unknown;
  schedule: string | null;
  createdAt: Date | string;
  nextRunAt?: Date | string | null;
  humanizedSchedule?: string;
};

type LoopTriggersCardProps = {
  loopId: string;
  loopStatus: string;
  triggers: LoopTriggerCardRow[];
  onTriggersChanged: () => void;
  surface?: "legacy" | "automation";
};

function formatNextRun(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function LoopTriggersCard({
  loopId,
  loopStatus,
  triggers,
  onTriggersChanged,
  surface = "legacy",
}: LoopTriggersCardProps) {
  const automationSurface = surface === "automation";
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const warning = getTriggersInactiveWarning({
    status: loopStatus,
    triggerCount: triggers.length,
  });

  async function handleAddTrigger(input: NewTriggerInput) {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/agent-loops/${loopId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setFormError(body.message ?? "Failed to create trigger.");
        return;
      }
      toast.success("Trigger added");
      setShowAddForm(false);
      onTriggersChanged();
    } catch {
      setFormError(
        "Failed to create trigger. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(triggerId: string, nextEnabled: boolean) {
    setPendingToggleId(triggerId);
    try {
      const res = await fetch(
        `/api/agent-loops/${loopId}/triggers/${triggerId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextEnabled ? "enabled" : "disabled",
          }),
        },
      );
      if (!res.ok) {
        toast.error("Failed to update trigger.");
        return;
      }
      onTriggersChanged();
    } catch {
      toast.error("Failed to update trigger.");
    } finally {
      setPendingToggleId(null);
    }
  }

  async function handleDelete(triggerId: string) {
    try {
      const res = await fetch(
        `/api/agent-loops/${loopId}/triggers/${triggerId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error("Failed to delete trigger.");
        return;
      }
      toast.success("Trigger deleted");
      onTriggersChanged();
    } catch {
      toast.error("Failed to delete trigger.");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <section className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Triggers</h2>
        {!showAddForm && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm(true)}
          >
            Add trigger
          </Button>
        )}
      </div>

      {warning && (
        <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          {warning}
        </div>
      )}

      {triggers.length === 0 && !showAddForm ? (
        <div className="p-4 text-xs text-muted-foreground">
          {automationSurface
            ? "No triggers yet — this Automation only runs when you press Run now. Add one:"
            : "No triggers yet — this loop only runs when you press Run now. Add one:"}
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddForm(true)}
            >
              Add trigger
            </Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {triggers.map((trigger) => {
            const humanized =
              trigger.humanizedSchedule ?? humanizeSchedule(trigger.schedule);
            const nextRun = formatNextRun(trigger.nextRunAt);
            return (
              <div key={trigger.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {getTriggerKindLabel(trigger.kind)}
                    </p>
                    {trigger.kind === "schedule.cron" && humanized && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {humanized}
                      </p>
                    )}
                    {nextRun && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Next run: {nextRun} UTC
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={trigger.status} />
                    <label
                      className="flex items-center gap-1.5"
                      htmlFor={`trigger-toggle-${trigger.id}`}
                    >
                      <span className="sr-only">
                        {trigger.status === "enabled" ? "Disable" : "Enable"}{" "}
                        trigger
                      </span>
                      <Switch
                        id={`trigger-toggle-${trigger.id}`}
                        checked={trigger.status === "enabled"}
                        disabled={pendingToggleId === trigger.id}
                        onCheckedChange={(checked) =>
                          handleToggle(trigger.id, checked)
                        }
                        aria-label={
                          trigger.status === "enabled"
                            ? "Disable trigger"
                            : "Enable trigger"
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete trigger"
                      onClick={() => setPendingDeleteId(trigger.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <LoopTriggerAddForm
          submitting={saving}
          error={formError}
          onSubmit={handleAddTrigger}
          onCancel={() => {
            setShowAddForm(false);
            setFormError(null);
          }}
        />
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trigger?</AlertDialogTitle>
            <AlertDialogDescription>
              {automationSurface
                ? "This Automation will stop firing automatically for this trigger. This cannot be undone."
                : "This loop will stop firing automatically for this trigger. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) {
                  void handleDelete(pendingDeleteId);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
