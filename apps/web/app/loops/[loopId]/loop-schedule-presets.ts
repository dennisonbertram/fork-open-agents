/**
 * Schedule presets for the loop Triggers card's add-trigger form (#762).
 *
 * Named/worded to match the issue's product spec exactly: "hourly /
 * nightly-2am-UTC / weekdays-9am-UTC + custom cron". Kept separate from
 * lib/background-agents/schedule-presets.ts's SCHEDULE_PRESETS (a different
 * label/value set used by the background-agents settings UI) so a change to
 * one surface's presets doesn't silently change the other's.
 */

export type LoopSchedulePreset = {
  id: "hourly" | "nightly" | "weekdays" | "custom";
  label: string;
  /** 5-field cron string, or null for "custom" (user supplies their own). */
  value: string | null;
};

export const LOOP_SCHEDULE_PRESETS: LoopSchedulePreset[] = [
  { id: "hourly", label: "Hourly", value: "0 * * * *" },
  { id: "nightly", label: "Nightly at 2am UTC", value: "0 2 * * *" },
  { id: "weekdays", label: "Weekdays at 9am UTC", value: "0 9 * * 1-5" },
  { id: "custom", label: "Custom cron", value: null },
];
