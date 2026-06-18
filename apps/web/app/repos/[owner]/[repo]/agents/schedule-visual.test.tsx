/**
 * Tests for describeSchedule + ScheduleVisual: weekday/time derivation and render.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleVisual, describeSchedule } from "./schedule-visual";

describe("describeSchedule", () => {
  test("weekly schedule reports only its weekdays", () => {
    expect(describeSchedule("0 9 * * 1,3,5")).toEqual({
      activeDays: [1, 3, 5],
      timeLabel: "at 09:00 UTC",
    });
  });

  test("daily schedule marks all 7 days", () => {
    expect(describeSchedule("30 8 * * *")).toEqual({
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      timeLabel: "every day at 08:30 UTC",
    });
  });

  test("hourly schedule reports minutes past the hour", () => {
    expect(describeSchedule("15 * * * *")).toEqual({
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      timeLabel: "every hour at :15 UTC",
    });
  });

  test("returns null for custom/unparseable cron", () => {
    expect(describeSchedule("*/5 * * * *")).toBeNull();
  });
});

describe("ScheduleVisual", () => {
  test("renders highlighted weekday strip for a weekly schedule", () => {
    const html = renderToStaticMarkup(
      <ScheduleVisual schedule="0 9 * * 1-5" />,
    );
    // All seven day labels appear.
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(html).toContain(day);
    }
    // Active weekdays use the primary fill; at least the 5 weekdays do.
    const activeCount = (
      html.match(/bg-primary text-primary-foreground/g) ?? []
    ).length;
    expect(activeCount).toBe(5);
    expect(html).toContain("at 09:00 UTC");
  });

  test("custom cron still renders the run preview without a weekday strip", () => {
    const html = renderToStaticMarkup(
      <ScheduleVisual schedule="*/5 * * * *" />,
    );
    expect(html).not.toContain("bg-primary text-primary-foreground");
  });
});
