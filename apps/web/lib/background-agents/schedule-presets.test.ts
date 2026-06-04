import { describe, expect, test } from "bun:test";
import {
  SCHEDULE_PRESETS,
  computeNextRuns,
  validateSchedule,
} from "./schedule-presets";

describe("SCHEDULE_PRESETS", () => {
  test("BT-001: contains Hourly, Daily morning, Weekdays morning, Weekly, Custom cron presets", () => {
    const labels = SCHEDULE_PRESETS.map((p) => p.label);
    expect(labels).toContain("Hourly");
    expect(labels).toContain("Daily (morning)");
    expect(labels).toContain("Weekdays (morning)");
    expect(labels).toContain("Weekly");
    expect(labels).toContain("Custom cron");
  });

  test("BT-001: each preset has a cron value (or null for Custom cron)", () => {
    for (const preset of SCHEDULE_PRESETS) {
      if (preset.label === "Custom cron") {
        expect(preset.value).toBeNull();
      } else {
        expect(typeof preset.value).toBe("string");
        expect(preset.value).not.toBe("");
      }
    }
  });
});

describe("computeNextRuns", () => {
  // 2026-06-01 Monday 08:00 UTC
  const baseDate = new Date("2026-06-01T08:00:00.000Z");

  test("BT-001: returns exactly N next runs for @hourly", () => {
    const runs = computeNextRuns("@hourly", baseDate, 3);
    expect(runs).toHaveLength(3);
    // First run should be at 09:00 UTC (next hour)
    expect(runs[0]?.getUTCHours()).toBe(9);
    expect(runs[0]?.getUTCMinutes()).toBe(0);
    // Second at 10:00 UTC
    expect(runs[1]?.getUTCHours()).toBe(10);
    // Third at 11:00 UTC
    expect(runs[2]?.getUTCHours()).toBe(11);
  });

  test("BT-001: returns next 3 runs for a specific daily cron", () => {
    // 0 9 * * * = 09:00 UTC daily
    const runs = computeNextRuns("0 9 * * *", baseDate, 3);
    expect(runs).toHaveLength(3);
    // First run is today at 09:00 UTC (base is 08:00)
    expect(runs[0]?.getUTCHours()).toBe(9);
    expect(runs[0]?.getUTCMinutes()).toBe(0);
    // Next day at 09:00
    expect(runs[1]?.getUTCDate()).toBe(2);
    expect(runs[2]?.getUTCDate()).toBe(3);
  });

  test("BT-001: returns exactly 1 run when count=1", () => {
    const runs = computeNextRuns("@hourly", baseDate, 1);
    expect(runs).toHaveLength(1);
  });

  test("BT-001: returns empty array for invalid schedule", () => {
    const runs = computeNextRuns("not a cron", baseDate, 3);
    expect(runs).toHaveLength(0);
  });

  test("BT-001: returns empty array for null schedule", () => {
    const runs = computeNextRuns(null, baseDate, 3);
    expect(runs).toHaveLength(0);
  });

  test("BT-001: returned dates are after the fromDate (not equal)", () => {
    // Test with exact match time
    const exactMatch = new Date("2026-06-01T09:00:00.000Z");
    const runs = computeNextRuns("0 9 * * *", exactMatch, 3);
    // Should not include exact match, only future runs
    for (const run of runs) {
      expect(run.getTime()).toBeGreaterThan(exactMatch.getTime());
    }
  });

  test("BT-001: @daily next runs are at midnight UTC", () => {
    const runs = computeNextRuns("@daily", baseDate, 3);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.getUTCHours()).toBe(0);
      expect(run.getUTCMinutes()).toBe(0);
    }
  });

  test("BT-001: weekday cron skips weekends", () => {
    // 0 9 * * 1-5 = 09:00 UTC Mon-Fri
    // Base: Monday 2026-06-01 08:00 UTC
    const runs = computeNextRuns("0 9 * * 1-5", baseDate, 3);
    expect(runs).toHaveLength(3);
    // All should be weekdays
    for (const run of runs) {
      const day = run.getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });
});

describe("validateSchedule", () => {
  test("BT-002: returns valid:true for @hourly shortcut", () => {
    expect(validateSchedule("@hourly")).toEqual({ valid: true });
  });

  test("BT-002: returns valid:true for @daily shortcut", () => {
    expect(validateSchedule("@daily")).toEqual({ valid: true });
  });

  test("BT-002: returns valid:true for @weekly shortcut", () => {
    expect(validateSchedule("@weekly")).toEqual({ valid: true });
  });

  test("BT-002: returns valid:true for valid 5-field cron", () => {
    expect(validateSchedule("0 9 * * 1-5")).toEqual({ valid: true });
    expect(validateSchedule("*/5 * * * *")).toEqual({ valid: true });
    expect(validateSchedule("30 14 * * 0")).toEqual({ valid: true });
  });

  test("BT-002: returns valid:false with error for free-text schedule", () => {
    const result = validateSchedule("every morning");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  test("BT-002: returns valid:false with error for 6-field cron (seconds not supported)", () => {
    const result = validateSchedule("0 0 9 * * 1-5");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("BT-002: returns valid:false with error for out-of-range field", () => {
    const result = validateSchedule("60 9 * * *"); // minute 60 invalid
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("BT-002: error message names the supported grammar", () => {
    const result = validateSchedule("nope");
    expect(result.valid).toBe(false);
    // Should mention the supported formats
    expect(result.error).toMatch(/@hourly|@daily|@weekly|5-field|cron/i);
  });

  test("BT-002: returns valid:false for empty string", () => {
    const result = validateSchedule("");
    expect(result.valid).toBe(false);
  });

  test("BT-002: returns valid:false for null", () => {
    const result = validateSchedule(null);
    expect(result.valid).toBe(false);
  });
});
