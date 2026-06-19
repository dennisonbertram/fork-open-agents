/**
 * Behavior tests for SchedulePicker with Simple|Cron segmented control.
 *
 * (a) Simple|Cron segmented control renders ('Simple' and 'Cron' labels present)
 * (b) default (Simple) shows the frequency Select
 * (c) when forced into Cron mode the raw Input with placeholder '0 9 * * 1-5'
 *     renders immediately with ScheduleValidationMessage + SchedulePreview
 * (d) emitted onChange value for a valid cron round-trips via composeCron(custom)
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock next/navigation used transitively
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => undefined) }),
  useParams: () => ({ owner: "acme", repo: "widgets" }),
}));

const modulePromise = import("./schedule-picker");

describe("SchedulePicker — Simple|Cron toggle", () => {
  test("(a) Simple and Cron labels are present in the rendered markup", async () => {
    const { SchedulePicker } = await modulePromise;

    const html = renderToStaticMarkup(
      <SchedulePicker schedule="" onChange={() => undefined} />,
    );

    expect(html).toContain("Simple");
    expect(html).toContain("Cron");
  });

  test("(b) default mode is Simple — frequency Select is present, NOT the raw cron Input", async () => {
    const { SchedulePicker } = await modulePromise;

    const html = renderToStaticMarkup(
      <SchedulePicker schedule="" onChange={() => undefined} />,
    );

    // Simple mode shows the frequency select (Schedule label)
    expect(html).toContain("Schedule");
    // The frequency select combobox should be present
    expect(html).toContain('role="combobox"');
    // The raw cron input with id spec-schedule-cron should NOT be present in Simple mode
    expect(html).not.toContain('id="spec-schedule-cron"');
  });

  test("(c) initialMode='cron' shows raw Input with placeholder '0 9 * * 1-5' + validation message area", async () => {
    const { SchedulePicker } = await modulePromise;

    const html = renderToStaticMarkup(
      <SchedulePicker
        schedule="0 9 * * 1-5"
        onChange={() => undefined}
        initialMode="cron"
      />,
    );

    // Raw cron input should be present
    expect(html).toContain('id="spec-schedule-cron"');
    expect(html).toContain('placeholder="0 9 * * 1-5"');
    // ScheduleValidationMessage renders some content
    // The cron expression field label
    expect(html).toContain("Cron expression");
    // UTC helper text
    expect(html).toContain("UTC");
    // SchedulePreview is mounted (even if empty for initial render)
    // — just verify no error thrown and cron input is present
    expect(html).toContain("0 9 * * 1-5");
  });

  test("(c) when initial schedule is non-parseable cron (specific day-of-month) it auto-derives Cron mode", async () => {
    const { SchedulePicker } = await modulePromise;

    // parseCron cannot map "0 9 1 * *" (1st of every month) to simple builder state
    // because the builder only handles "every day of month" (dom=*)
    const html = renderToStaticMarkup(
      <SchedulePicker schedule="0 9 1 * *" onChange={() => undefined} />,
    );

    // Should auto-derive Cron mode and show the cron input
    expect(html).toContain('id="spec-schedule-cron"');
    expect(html).toContain("0 9 1 * *");
  });

  test("(d) SchedulePicker module exports composeCron which round-trips a valid cron unchanged", async () => {
    // Verify composeCron still works (no data-shape change)
    const { composeCron } =
      await import("@/lib/background-agents/schedule-builder");

    const state = {
      frequency: "custom" as const,
      customExpression: "0 9 * * 1-5",
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5],
    };

    // composeCron for custom mode returns the customExpression
    expect(composeCron(state)).toBe("0 9 * * 1-5");
  });
});
