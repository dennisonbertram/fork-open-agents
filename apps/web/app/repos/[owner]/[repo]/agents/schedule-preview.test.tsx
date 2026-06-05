/**
 * Tests for SchedulePreview component and ScheduleValidationMessage component.
 * BT-001: Preset selected → next 3 run times render in the user's LOCAL time.
 * BT-002: Invalid schedule → inline validation message explains supported grammar.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Lazy imports so mocking runs first
const componentModulePromise = import("./schedule-preview");

describe("SchedulePreview", () => {
  test("BT-001: renders 3 upcoming run times for a valid cron schedule", async () => {
    const { SchedulePreview } = await componentModulePromise;
    const fromDate = new Date("2026-06-01T08:00:00.000Z");

    const html = renderToStaticMarkup(
      <SchedulePreview
        schedule="0 9 * * *"
        fromDate={fromDate}
        label="Next 3 runs"
      />,
    );

    // Should show the label
    expect(html).toContain("Next 3 runs");
    // Should show 3 run times
    const matches = html.match(/\d{1,2}:\d{2}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test("BT-001: renders 3 upcoming run times for @hourly shortcut", async () => {
    const { SchedulePreview } = await componentModulePromise;
    const fromDate = new Date("2026-06-01T08:00:00.000Z");

    const html = renderToStaticMarkup(
      <SchedulePreview schedule="@hourly" fromDate={fromDate} />,
    );

    // Should show run times (at least 3 time values)
    const matches = html.match(/\d{1,2}:\d{2}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test("BT-001: renders nothing when schedule is null", async () => {
    const { SchedulePreview } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <SchedulePreview schedule={null} fromDate={new Date()} />,
    );

    // Should render empty or a placeholder, not crash
    expect(html).not.toContain("Error");
    expect(html.length).toBeLessThan(100); // Empty / very small output
  });

  test("BT-002: renders validation error for invalid schedule", async () => {
    const { SchedulePreview } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <SchedulePreview schedule="every morning" fromDate={new Date()} />,
    );

    // Should show a validation error message
    expect(html).toMatch(/invalid|unsupported|error/i);
  });
});

describe("ScheduleValidationMessage", () => {
  test("BT-002: renders nothing for a valid schedule", async () => {
    const { ScheduleValidationMessage } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ScheduleValidationMessage schedule="@daily" />,
    );

    expect(html.length).toBeLessThan(10); // Empty output
  });

  test("BT-002: renders error message for invalid schedule", async () => {
    const { ScheduleValidationMessage } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <ScheduleValidationMessage schedule="not a cron" />,
    );

    expect(html).toMatch(/@hourly|@daily|@weekly|5-field|cron/i);
  });

  test("BT-002: renders nothing for empty string (empty=no schedule set)", async () => {
    const { ScheduleValidationMessage } = await componentModulePromise;

    // Empty string means user hasn't filled in yet — no error shown
    const html = renderToStaticMarkup(
      <ScheduleValidationMessage schedule="" />,
    );

    expect(html.length).toBeLessThan(10);
  });
});
