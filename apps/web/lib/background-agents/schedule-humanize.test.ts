/**
 * TDD RED tests for #762 — plain-language cron rendering with an explicit
 * UTC label. Reuses computeNextRuns / parseCron rather than adding a new
 * cron-humanizer dependency (schedule-visual.tsx already has a partial
 * humanizer for the builder-expressible cases — this module generalizes it
 * to also produce a readable sentence for raw/custom cron).
 */
import { describe, expect, test } from "bun:test";
import { humanizeSchedule } from "./schedule-humanize";

describe("humanizeSchedule (#762)", () => {
  test("renders an hourly schedule in plain language with UTC label", () => {
    const result = humanizeSchedule("0 * * * *");
    expect(result).toMatch(/hour/i);
    expect(result).toMatch(/UTC/);
  });

  test("renders a daily schedule in plain language with UTC label", () => {
    const result = humanizeSchedule("0 9 * * *");
    expect(result).toMatch(/day/i);
    expect(result).toMatch(/09:00|9:00/);
    expect(result).toMatch(/UTC/);
  });

  test("renders a weekday schedule in plain language with UTC label", () => {
    const result = humanizeSchedule("0 9 * * 1-5");
    expect(result).toMatch(/weekday/i);
    expect(result).toMatch(/UTC/);
  });

  test("renders @hourly macro in plain language", () => {
    const result = humanizeSchedule("@hourly");
    expect(result).toMatch(/hour/i);
    expect(result).toMatch(/UTC/);
  });

  test("falls back to a readable custom-cron label for non-builder-expressible cron", () => {
    const result = humanizeSchedule("*/15 * * * *");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/UTC/);
    // Must not throw jargon-only text with no explanation.
    expect(result).not.toBe("*/15 * * * *");
  });

  test("returns an empty string for null/empty schedule", () => {
    expect(humanizeSchedule(null)).toBe("");
    expect(humanizeSchedule("")).toBe("");
  });

  test("returns an invalid-schedule message for an invalid cron expression", () => {
    const result = humanizeSchedule("not-a-cron");
    expect(result).toMatch(/invalid/i);
  });
});
