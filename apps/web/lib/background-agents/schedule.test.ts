import { describe, expect, test } from "bun:test";
import { scheduleMatchesNow } from "./schedule";

describe("scheduleMatchesNow", () => {
  const mondayAt1430 = new Date("2026-06-01T14:30:00.000Z");

  test("matches empty schedules on every dispatcher tick", () => {
    expect(scheduleMatchesNow(null, mondayAt1430)).toBe(true);
    expect(scheduleMatchesNow("", mondayAt1430)).toBe(true);
  });

  test("matches shortcut schedules in UTC", () => {
    expect(scheduleMatchesNow("@hourly", mondayAt1430)).toBe(false);
    expect(
      scheduleMatchesNow("@hourly", new Date("2026-06-01T14:00:00.000Z")),
    ).toBe(true);
    expect(
      scheduleMatchesNow("@daily", new Date("2026-06-01T00:00:00.000Z")),
    ).toBe(true);
  });

  test("matches five-field cron schedules", () => {
    expect(scheduleMatchesNow("*/5 * * * *", mondayAt1430)).toBe(true);
    expect(
      scheduleMatchesNow("*/5 * * * *", new Date("2026-06-01T14:31:00.000Z")),
    ).toBe(false);
    expect(scheduleMatchesNow("31 14 * * *", new Date(mondayAt1430))).toBe(
      false,
    );
    expect(scheduleMatchesNow("30 14 * * 1", mondayAt1430)).toBe(true);
  });

  test("rejects invalid schedule expressions", () => {
    expect(scheduleMatchesNow("every once in a while", mondayAt1430)).toBe(
      false,
    );
  });
});
