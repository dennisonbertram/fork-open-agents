"use client";

/**
 * loop-trigger-add-form.tsx — schedule|event tabs form for adding a trigger
 * to a loop (#762).
 *
 * Schedule tab: preset picker (hourly / nightly 2am UTC / weekdays 9am UTC /
 * custom cron) + always-visible plain-language rendering with an explicit
 * UTC label and the next 3 computed fire times.
 *
 * Event tab: picks one of the GitHub event kinds the dispatcher already
 * matches (pull_request, issues, deployment_status, pull_request_review,
 * check_suite).
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanizeSchedule } from "@/lib/background-agents/schedule-humanize";
import { computeNextRuns } from "@/lib/background-agents/schedule-presets";
import {
  LOOP_EVENT_TRIGGER_KINDS,
  LOOP_TRIGGER_KIND_LABELS,
  type LoopEventTriggerKind,
} from "./loop-trigger-kind-labels";
import { LOOP_SCHEDULE_PRESETS } from "./loop-schedule-presets";

export type NewTriggerInput =
  | { kind: "schedule.cron"; name: string; schedule: string }
  | { kind: LoopEventTriggerKind; name: string };

type LoopTriggerAddFormProps = {
  onSubmit: (input: NewTriggerInput) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
};

function formatUtcTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function LoopTriggerAddForm({
  onSubmit,
  onCancel,
  submitting,
  error,
}: LoopTriggerAddFormProps) {
  const [tab, setTab] = useState<"schedule" | "event">("schedule");
  const [presetId, setPresetId] = useState<
    "hourly" | "nightly" | "weekdays" | "custom"
  >("nightly");
  const [customCron, setCustomCron] = useState("0 2 * * *");
  const [eventKind, setEventKind] = useState<LoopEventTriggerKind>(
    "github.pull_request",
  );

  const selectedPreset = LOOP_SCHEDULE_PRESETS.find((p) => p.id === presetId);
  const schedule =
    presetId === "custom" ? customCron : (selectedPreset?.value ?? "");

  const humanized = useMemo(() => humanizeSchedule(schedule), [schedule]);
  const nextFires = useMemo(() => {
    if (!schedule) return [];
    return computeNextRuns(schedule, new Date(), 3);
  }, [schedule]);

  function handleSubmit() {
    if (tab === "schedule") {
      void onSubmit({
        kind: "schedule.cron",
        name: `Schedule: ${humanized || schedule}`,
        schedule,
      });
    } else {
      void onSubmit({
        kind: eventKind,
        name: LOOP_TRIGGER_KIND_LABELS[eventKind],
      });
    }
  }

  return (
    <div className="space-y-3 border-t border-border p-4">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "schedule" | "event")}
      >
        <TabsList aria-label="Trigger type">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="event">Event</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="loop-trigger-preset">Schedule</Label>
            <Select
              value={presetId}
              onValueChange={(v) => setPresetId(v as typeof presetId)}
            >
              <SelectTrigger id="loop-trigger-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOP_SCHEDULE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {presetId === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="loop-trigger-cron">Cron expression</Label>
              <Input
                id="loop-trigger-cron"
                value={customCron}
                placeholder="0 9 * * 1-5"
                onChange={(e) => setCustomCron(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Five fields, in UTC — minute hour day month weekday.
              </p>
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
            <p className="text-sm text-foreground">
              {humanized || "Enter a schedule to see when it will run."}
            </p>
            {nextFires.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Next 3 runs (UTC)
                </p>
                <ul className="space-y-0.5">
                  {nextFires.map((run) => (
                    <li
                      key={run.toISOString()}
                      className="text-xs text-foreground"
                    >
                      {formatUtcTime(run)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="event" className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="loop-trigger-event-kind">When this happens</Label>
            <Select
              value={eventKind}
              onValueChange={(v) => setEventKind(v as LoopEventTriggerKind)}
            >
              <SelectTrigger id="loop-trigger-event-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOP_EVENT_TRIGGER_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {LOOP_TRIGGER_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </TabsContent>
      </Tabs>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving…" : "Save trigger"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
