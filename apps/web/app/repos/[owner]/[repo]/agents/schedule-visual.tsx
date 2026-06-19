"use client";

import { cn } from "@/lib/utils";
import { parseCron } from "@/lib/background-agents/schedule-builder";
import { SchedulePreview } from "./schedule-preview";

type ScheduleVisualProps = {
  schedule: string;
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

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Derive which weekdays are active and a human time label from a cron schedule.
 * Returns null when the schedule is not builder-expressible (custom cron) — the
 * caller then falls back to just the run preview.
 */
export function describeSchedule(
  schedule: string,
): { activeDays: number[]; timeLabel: string } | null {
  const parsed = parseCron(schedule);
  if (!parsed || parsed.frequency === "custom") {
    return null;
  }
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  if (parsed.frequency === "hourly") {
    return {
      activeDays: allDays,
      timeLabel: `every hour at :${two(parsed.minute)} UTC`,
    };
  }
  if (parsed.frequency === "daily") {
    return {
      activeDays: allDays,
      timeLabel: `every day at ${two(parsed.hour)}:${two(parsed.minute)} UTC`,
    };
  }
  return {
    activeDays: parsed.weekdays,
    timeLabel: `at ${two(parsed.hour)}:${two(parsed.minute)} UTC`,
  };
}

/**
 * Visual summary of a cron schedule: a Sun–Sat weekday strip highlighting the
 * days it fires, a plain-language time, and the next upcoming run times.
 */
export function ScheduleVisual({ schedule }: ScheduleVisualProps) {
  const described = describeSchedule(schedule);

  return (
    <div className="mt-2 space-y-2">
      {described && (
        <div className="flex flex-wrap items-center gap-1.5">
          {WEEKDAYS.map((d) => {
            const active = described.activeDays.includes(d.value);
            return (
              <span
                key={d.value}
                className={cn(
                  "inline-flex h-6 items-center rounded px-1.5 text-[10px] font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground",
                )}
              >
                {d.label}
              </span>
            );
          })}
          <span className="text-xs text-muted-foreground">
            {described.timeLabel}
          </span>
        </div>
      )}
      <SchedulePreview
        schedule={schedule}
        fromDate={new Date()}
        label="Next runs"
      />
    </div>
  );
}
