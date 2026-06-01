import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowGoalEventJson, WorkflowGoalJson } from "./hooks/use-session-observability";
import { GoalLedgerSection } from "./goal-ledger-panel";

function makeGoal(overrides: Partial<WorkflowGoalJson> = {}): WorkflowGoalJson {
  return {
    id: "goal-1",
    objective: "Implement dark mode toggle",
    status: "running",
    blockedReason: null,
    evidenceRefs: [],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T11:00:00.000Z",
    events: [],
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<WorkflowGoalEventJson> = {},
): WorkflowGoalEventJson {
  return {
    id: "event-1",
    eventType: "goal_started",
    summary: "Goal execution started.",
    sequence: 1,
    payload: {},
    createdAt: "2026-05-01T10:01:00.000Z",
    ...overrides,
  };
}

describe("GoalLedgerSection", () => {
  test("BT-006: renders goal objective and status chip", () => {
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[makeGoal()]} />,
    );

    expect(html).toContain("Implement dark mode toggle");
    // Status chip must show the status value
    expect(html).toContain("running");
  });

  test("BT-007: renders ordered event timeline with sequence, eventType and summary", () => {
    const events: WorkflowGoalEventJson[] = [
      makeEvent({ id: "ev-1", sequence: 1, eventType: "goal_started", summary: "Goal began." }),
      makeEvent({ id: "ev-2", sequence: 2, eventType: "progress", summary: "Halfway done." }),
      makeEvent({ id: "ev-3", sequence: 3, eventType: "goal_completed", summary: "Finished." }),
    ];
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[makeGoal({ events })]} />,
    );

    expect(html).toContain("goal_started");
    expect(html).toContain("Goal began.");
    expect(html).toContain("progress");
    expect(html).toContain("Halfway done.");
    expect(html).toContain("goal_completed");
    expect(html).toContain("Finished.");

    // Sequence numbers must be rendered
    expect(html).toContain("1");
    expect(html).toContain("2");
    expect(html).toContain("3");
  });

  test("BT-008: blocked goal shows blockedReason and a needs-attention affordance", () => {
    const html = renderToStaticMarkup(
      <GoalLedgerSection
        goals={[
          makeGoal({
            status: "blocked",
            blockedReason: "Waiting for external API credentials",
          }),
        ]}
      />,
    );

    expect(html).toContain("blocked");
    expect(html).toContain("Waiting for external API credentials");
    // "Needs attention" marker must be present for blocked goals
    expect(html).toContain("Needs attention");
  });

  test("BT-009: awaiting_input goal shows needs-attention affordance", () => {
    const html = renderToStaticMarkup(
      <GoalLedgerSection
        goals={[
          makeGoal({
            status: "awaiting_input",
            blockedReason: "Awaiting user confirmation",
          }),
        ]}
      />,
    );

    expect(html).toContain("awaiting_input");
    expect(html).toContain("Awaiting user confirmation");
    expect(html).toContain("Needs attention");
  });

  test("BT-010: renders evidence refs when present", () => {
    const html = renderToStaticMarkup(
      <GoalLedgerSection
        goals={[makeGoal({ evidenceRefs: ["commit-abc123", "pr-42"] })]}
      />,
    );

    expect(html).toContain("commit-abc123");
    expect(html).toContain("pr-42");
  });

  test("BT-011: renders empty state when goals array is empty", () => {
    const html = renderToStaticMarkup(<GoalLedgerSection goals={[]} />);

    // Must show a muted empty-state message — not blank
    expect(html).toContain("No goals");
    // Must NOT render any goal-specific content
    expect(html).not.toContain("Implement dark mode toggle");
  });

  test("BT-012: renders multiple goals", () => {
    const goalA = makeGoal({ id: "g-1", objective: "Build auth service" });
    const goalB = makeGoal({ id: "g-2", objective: "Write e2e tests", status: "complete" });
    const html = renderToStaticMarkup(
      <GoalLedgerSection goals={[goalA, goalB]} />,
    );

    expect(html).toContain("Build auth service");
    expect(html).toContain("Write e2e tests");
    expect(html).toContain("complete");
  });
});
