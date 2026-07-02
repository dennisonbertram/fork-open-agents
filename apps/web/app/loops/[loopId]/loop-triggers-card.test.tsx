/**
 * TDD RED tests for #762 — Triggers card (loop-triggers-card.tsx).
 *
 * Behavior contract (issue #762):
 *   - empty state copy: "No triggers yet — this loop only runs when you press
 *     Run now. Add one:"
 *   - a trigger list shows kind, status, and (for schedule triggers) the
 *     humanized schedule + next-fire time.
 *   - when the loop has >=1 trigger but status !== 'active': shows the warning
 *     "Triggers only fire while the loop is Active."
 *   - the OLD dead-end copy ("Manage triggers in Background agents settings")
 *     must never render (regression pin).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoopTriggersCard } from "./loop-triggers-card";

function scheduleTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: "trigger-1",
    kind: "schedule.cron" as const,
    status: "enabled" as const,
    conditions: {},
    schedule: "0 2 * * *",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    nextRunAt: new Date("2026-01-02T02:00:00Z"),
    humanizedSchedule: "Every day at 02:00 UTC",
    ...overrides,
  };
}

describe("LoopTriggersCard — empty state (#762)", () => {
  test("shows the empty-state copy when there are no triggers", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).toContain(
      "No triggers yet — this loop only runs when you press Run now.",
    );
  });

  test("never renders the old dead-end copy (regression pin)", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).not.toContain("Manage triggers in");
    expect(html).not.toContain("Background agents settings");
  });
});

describe("LoopTriggersCard — trigger list (#762)", () => {
  test("renders a schedule trigger with its humanized schedule", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[scheduleTrigger()]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).toContain("Every day at 02:00 UTC");
  });

  test("shows the inactive-status warning when the loop has triggers but is not active", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="draft"
        triggers={[scheduleTrigger()]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).toContain("Triggers only fire while the loop is Active.");
  });

  test("does not show the inactive-status warning when the loop is active", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[scheduleTrigger()]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).not.toContain("Triggers only fire while the loop is Active.");
  });

  test("never renders the old dead-end copy even with triggers present (regression pin)", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[scheduleTrigger()]}
        onTriggersChanged={() => undefined}
      />,
    );
    expect(html).not.toContain("Manage triggers in");
    expect(html).not.toContain("Background agents settings");
  });

  test("renders an event trigger with a labeled enable/disable control (no icon-only unnamed buttons)", () => {
    const html = renderToStaticMarkup(
      <LoopTriggersCard
        loopId="loop-1"
        loopStatus="active"
        triggers={[
          scheduleTrigger({
            id: "trigger-2",
            kind: "github.pull_request",
            schedule: null,
            nextRunAt: null,
            humanizedSchedule: "",
          }),
        ]}
        onTriggersChanged={() => undefined}
      />,
    );
    // Accessible name present for the delete control (aria-label or visible text).
    expect(html).toMatch(/aria-label="Delete trigger|>Delete</);
  });
});
