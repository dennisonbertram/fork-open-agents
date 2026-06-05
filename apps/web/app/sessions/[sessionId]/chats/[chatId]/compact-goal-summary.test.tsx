import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowGoalJson } from "./hooks/use-session-observability";
import { CompactGoalSummary } from "./compact-goal-summary";
import { GoalLedgerSection } from "./goal-ledger-panel";

function makeGoal(overrides: Partial<WorkflowGoalJson> = {}): WorkflowGoalJson {
  return {
    id: "goal-1",
    objective: "Migrate to Postgres 17",
    status: "running",
    blockedReason: null,
    evidenceRefs: [],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T11:00:00.000Z",
    events: [],
    ...overrides,
  };
}

describe("CompactGoalSummary", () => {
  test("REGRESSION-001: renders nothing when goals array is empty", () => {
    const html = renderToStaticMarkup(<CompactGoalSummary goals={[]} />);
    // Component must return null — no chip rendered for empty state
    expect(html).toBe("");
  });

  test("REGRESSION-002: renders the active goal objective in the chip", () => {
    const html = renderToStaticMarkup(
      <CompactGoalSummary goals={[makeGoal()]} />,
    );
    expect(html).toContain("Migrate to Postgres 17");
    expect(html).toContain("running");
  });

  test("REGRESSION-003: blocked goal is prioritised over running goals", () => {
    const goals: WorkflowGoalJson[] = [
      makeGoal({ id: "g1", objective: "Running task", status: "running" }),
      makeGoal({
        id: "g2",
        objective: "Blocked by auth",
        status: "blocked",
        blockedReason: "API key revoked",
      }),
    ];
    const html = renderToStaticMarkup(<CompactGoalSummary goals={goals} />);

    // The blocked goal must be surfaced, not the running one
    expect(html).toContain("Blocked by auth");
    expect(html).not.toContain("Running task");
    expect(html).toContain("blocked");
  });

  test("REGRESSION-004: awaiting_input goal is prioritised over running goals", () => {
    const goals: WorkflowGoalJson[] = [
      makeGoal({ id: "g1", objective: "Running task", status: "running" }),
      makeGoal({
        id: "g2",
        objective: "Awaiting input",
        status: "awaiting_input",
      }),
    ];
    const html = renderToStaticMarkup(<CompactGoalSummary goals={goals} />);

    expect(html).toContain("Awaiting input");
    expect(html).not.toContain("Running task");
  });
});

describe("GoalLedgerSection regression coverage", () => {
  test("REGRESSION-005: status chip text is always rendered (regression for missing status)", () => {
    // If GoalStatusChip were removed/broken, this test catches it
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[makeGoal({ status: "validating" })]} />,
    );
    expect(html).toContain("validating");
  });

  test("REGRESSION-006: non-blocked goals do NOT show the Needs attention banner", () => {
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[makeGoal({ status: "running" })]} />,
    );
    expect(html).not.toContain("Needs attention");
  });

  test("REGRESSION-007: events are rendered in sequence order from the data (no re-sorting)", () => {
    // The component relies on the server having ordered events by sequence.
    // We pass them in order and verify all appear — regression catches
    // accidental reversal or filtering.
    const events: WorkflowGoalJson["events"] = [
      {
        id: "e1",
        eventType: "start",
        summary: "First.",
        sequence: 1,
        payload: {},
        createdAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "e2",
        eventType: "middle",
        summary: "Second.",
        sequence: 2,
        payload: {},
        createdAt: "2026-05-01T10:01:00.000Z",
      },
      {
        id: "e3",
        eventType: "end",
        summary: "Third.",
        sequence: 3,
        payload: {},
        createdAt: "2026-05-01T10:02:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[makeGoal({ events })]} />,
    );
    const firstPos = html.indexOf("First.");
    const secondPos = html.indexOf("Second.");
    const thirdPos = html.indexOf("Third.");
    expect(firstPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(thirdPos);
  });

  test("REGRESSION-008: empty-state message contains 'No goals' (empty-state regression)", () => {
    const html = renderToStaticMarkup(<GoalLedgerSection goals={[]} />);
    // If the empty-state branch is removed, this catches it
    expect(html).toContain("No goals");
  });
});
