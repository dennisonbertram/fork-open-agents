"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  composeCron,
  defaultScheduleBuilderState,
  parseCron,
  type ScheduleBuilderState,
  type ScheduleFrequency,
} from "@/lib/background-agents/schedule-builder";
import { SchedulePreview, ScheduleValidationMessage } from "./schedule-preview";

type SchedulePickerProps = {
  schedule: string;
  onChange: (schedule: string) => void;
};

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  custom: "Custom cron",
};

const WEEKDAYS: { label: string; value: number }[] = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i); // 0…23

function initialState(schedule: string): ScheduleBuilderState {
  const parsed = parseCron(schedule);
  if (parsed) {
    return parsed;
  }
  if (schedule.trim() !== "") {
    return {
      ...defaultScheduleBuilderState(),
      frequency: "custom",
      customExpression: schedule,
    };
  }
  return defaultScheduleBuilderState();
}

/**
 * Interactive schedule builder. Lets a human pick a frequency + time-of-day +
 * weekdays instead of hand-writing cron, while keeping a "Custom cron" escape
 * hatch for power users. Emits the composed 5-field cron string via onChange.
 * Times are interpreted as UTC (the scheduler evaluates cron in UTC).
 */
export function SchedulePicker({ schedule, onChange }: SchedulePickerProps) {
  const [state, setState] = useState<ScheduleBuilderState>(() =>
    initialState(schedule),
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(composeCron(state));
  }, [state]);

  function update(patch: Partial<ScheduleBuilderState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function toggleWeekday(day: number) {
    setState((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter((d) => d !== day)
        : [...prev.weekdays, day],
    }));
  }

  const composed = composeCron(state);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="spec-schedule-frequency">Schedule</Label>
        <Select
          value={state.frequency}
          onValueChange={(v) => update({ frequency: v as ScheduleFrequency })}
        >
          <SelectTrigger id="spec-schedule-frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.entries(FREQUENCY_LABELS) as [ScheduleFrequency, string][]
            ).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {state.frequency === "hourly" && (
        <div className="space-y-2">
          <Label htmlFor="spec-schedule-minute">Minutes past the hour</Label>
          <MinuteSelect
            id="spec-schedule-minute"
            value={state.minute}
            onChange={(minute) => update({ minute })}
          />
        </div>
      )}

      {state.frequency === "daily" && (
        <TimeOfDayFields
          hour={state.hour}
          minute={state.minute}
          onHourChange={(hour) => update({ hour })}
          onMinuteChange={(minute) => update({ minute })}
        />
      )}

      {state.frequency === "weekly" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Days</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const active = state.weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleWeekday(d.value)}
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <TimeOfDayFields
            hour={state.hour}
            minute={state.minute}
            onHourChange={(hour) => update({ hour })}
            onMinuteChange={(minute) => update({ minute })}
          />
        </div>
      )}

      {state.frequency === "custom" && (
        <div className="space-y-2">
          <Label htmlFor="spec-schedule">Cron expression</Label>
          <Input
            id="spec-schedule"
            value={state.customExpression}
            placeholder="0 9 * * 1-5"
            onChange={(e) => update({ customExpression: e.target.value })}
          />
          <ScheduleValidationMessage schedule={state.customExpression} />
        </div>
      )}

      {state.frequency !== "custom" && (
        <p className="font-mono text-[10px] text-muted-foreground">
          cron: {composed} · times in UTC
        </p>
      )}

      <SchedulePreview schedule={composed} fromDate={new Date()} />
    </div>
  );
}

function MinuteSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: number;
  onChange: (minute: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number.parseInt(v, 10))}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MINUTE_OPTIONS.map((m) => (
          <SelectItem key={m} value={String(m)}>
            :{String(m).padStart(2, "0")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimeOfDayFields({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange: (hour: number) => void;
  onMinuteChange: (minute: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Time of day (UTC)</Label>
      <div className="flex items-center gap-2">
        <Select
          value={String(hour)}
          onValueChange={(v) => onHourChange(Number.parseInt(v, 10))}
        >
          <SelectTrigger className="w-20" aria-label="Hour">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOUR_OPTIONS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                {String(h).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <div className="w-20">
          <MinuteSelect value={minute} onChange={onMinuteChange} />
        </div>
      </div>
    </div>
  );
}
