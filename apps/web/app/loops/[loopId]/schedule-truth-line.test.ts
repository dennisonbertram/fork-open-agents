/**
 * schedule-truth-line.test.ts (#767)
 *
 * Loop detail's schedule-truth statement, derived from the Triggers card
 * data (#762 GET returns nextRunAt + humanizedSchedule per trigger):
 *   - "Next run: <time> UTC" when an enabled schedule trigger exists
 *   - "No schedule — runs only when you press Run now." when none
 *   - reflects that the loop must also be active for triggers to fire
 */

import { describe, expect, it } from "bun:test";
import { getScheduleTruthLine } from "./schedule-truth-line";

const scheduleTrigger = {
  id: "trig_1",
  kind: "schedule" as const,
  status: "enabled",
  nextRunAt: "2026-07-03T14:30:00.000Z",
  humanizedSchedule: "Daily at 2:30 PM UTC",
};

describe("getScheduleTruthLine", () => {
  it("states the next run time when an enabled schedule trigger exists and loop is active", () => {
    const line = getScheduleTruthLine({
      loopStatus: "active",
      triggers: [scheduleTrigger],
    });
    expect(line).toContain("Next run");
    expect(line).toMatch(/UTC/);
  });

  it("says there's no schedule when there are no triggers", () => {
    const line = getScheduleTruthLine({ loopStatus: "active", triggers: [] });
    expect(line).toBe(
      "No schedule — runs only when you press Run now.",
    );
  });

  it("says there's no schedule when only event (non-schedule) triggers exist", () => {
    const line = getScheduleTruthLine({
      loopStatus: "active",
      triggers: [{ ...scheduleTrigger, kind: "event", nextRunAt: null }],
    });
    expect(line).toBe(
      "No schedule — runs only when you press Run now.",
    );
  });

  it("ignores a disabled schedule trigger", () => {
    const line = getScheduleTruthLine({
      loopStatus: "active",
      triggers: [{ ...scheduleTrigger, status: "disabled" }],
    });
    expect(line).toBe(
      "No schedule — runs only when you press Run now.",
    );
  });

  it("notes the loop isn't active even when a schedule trigger exists", () => {
    const line = getScheduleTruthLine({
      loopStatus: "paused",
      triggers: [scheduleTrigger],
    });
    expect(line.toLowerCase()).toContain("active");
  });
});
