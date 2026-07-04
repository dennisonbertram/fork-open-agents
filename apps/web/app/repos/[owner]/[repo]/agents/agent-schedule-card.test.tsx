/**
 * Tests for AgentScheduleCard — shows last-run, next-run from persisted state,
 * and disabled/misconfigured states.
 * BT-007: Dashboard agent card shows last run and next run from persisted server state.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const componentModulePromise = import("./agent-schedule-card");

type AgentScheduleTrigger = {
  id: string;
  schedule: string | null;
  status: "enabled" | "disabled";
  lastRunAt: string | Date | null;
  nextRunAt: string | Date | null;
  lastSkipReason: string | null;
};

describe("AgentScheduleCard", () => {
  test("BT-007: shows last run time and next run time when both are available", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-1",
      schedule: "0 9 * * *",
      status: "enabled",
      lastRunAt: new Date("2026-06-01T09:00:00.000Z"),
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toContain("Last run");
    expect(html).toContain("Next run");
    // Should render dates (some date-like content)
    expect(html).toMatch(/Jun|2026/);
  });

  test("BT-007: shows 'Never' when lastRunAt is null", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-2",
      schedule: "0 9 * * *",
      status: "enabled",
      lastRunAt: null,
      nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toContain("Never");
  });

  test("BT-007: shows disabled state when trigger is disabled", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-3",
      schedule: "0 9 * * *",
      status: "disabled",
      lastRunAt: null,
      nextRunAt: null,
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toMatch(/disabled/i);
  });

  test("BT-007: shows skip reason when lastSkipReason is set", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-4",
      schedule: "invalid cron",
      status: "enabled",
      lastRunAt: null,
      nextRunAt: null,
      lastSkipReason: "invalid schedule expression",
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toMatch(/invalid|skip/i);
  });

  test("BT-007: shows cron not configured when schedule is null", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-5",
      schedule: null,
      status: "enabled",
      lastRunAt: null,
      nextRunAt: null,
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toMatch(/not configured|no schedule/i);
  });

  test("BT-007: shows next run from persisted nextRunAt even when nextRunAt is a string", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-6",
      schedule: "0 9 * * *",
      status: "enabled",
      lastRunAt: "2026-06-01T09:00:00.000Z",
      nextRunAt: "2026-06-02T09:00:00.000Z",
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toContain("Next run");
    expect(html).toContain("Last run");
    expect(html).toMatch(/Jun|2026/);
  });

  test("BT-863: renders lastRunAt via the shared UTC-labeled formatter", async () => {
    const { AgentScheduleCard } = await componentModulePromise;

    const trigger: AgentScheduleTrigger = {
      id: "trigger-863",
      schedule: "0 9 * * *",
      status: "enabled",
      lastRunAt: new Date("2026-07-03T21:20:00Z"),
      nextRunAt: null,
      lastSkipReason: null,
    };

    const html = renderToStaticMarkup(<AgentScheduleCard trigger={trigger} />);

    expect(html).toContain("Jul 3, 2026 at 9:20 PM UTC");
  });
});
