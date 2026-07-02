/**
 * Codex review (PR #824), P2-2: listAgentLoopEvents (agent-loops/store.ts) is
 * a newest-200 slice (desc(createdAt), limit: 200). agent-loop.step.composio.*
 * events are emitted before openAgent.generate's event storm within a step,
 * so a chatty run's newer events can push the early composio events out of
 * that window — the run detail page's deriveLoopComposioWarnings(events)
 * would never see them.
 *
 * mergeEventsForSummary is the pure, testable merge step: it takes the
 * capped newest-200 slice and an uncapped, composio-scoped slice and returns
 * a deduped union (by id), so a composio event that also happens to be
 * within the capped 200 is not double-counted.
 */
import { describe, expect, test } from "bun:test";
import type { AgentLoopEvent } from "@/lib/db/schema";
import { mergeEventsForSummary } from "./merge-events-for-summary";

function makeEvent(overrides: Partial<AgentLoopEvent> = {}): AgentLoopEvent {
  return {
    id: "evt-1",
    loopRunId: "run-1",
    stepRunId: "step-1",
    nodeId: "node-1",
    eventName: "agent-loop.step.agent.completed",
    status: "succeeded",
    level: "info",
    summary: null,
    payload: {},
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: "wf-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("mergeEventsForSummary (#798 P2-2)", () => {
  test("BT-001: a composio event outside the capped slice is still included in the merged result", () => {
    const cappedSlice: AgentLoopEvent[] = Array.from(
      { length: 200 },
      (_, i) => makeEvent({ id: `noise-${i}` }),
    );
    const composioOnlySlice: AgentLoopEvent[] = [
      makeEvent({
        id: "ev-composio-off",
        eventName: "agent-loop.step.composio.off",
        level: "warn",
        payload: { reason: "no_slugs_selected" },
      }),
    ];

    const merged = mergeEventsForSummary(cappedSlice, composioOnlySlice);

    expect(merged.some((e) => e.id === "ev-composio-off")).toBe(true);
    expect(merged.length).toBe(201);
  });

  test("BT-002: a composio event present in BOTH slices is not duplicated (dedupe by id)", () => {
    const composioEvent = makeEvent({
      id: "ev-composio-off",
      eventName: "agent-loop.step.composio.off",
      level: "warn",
      payload: { reason: "no_slugs_selected" },
    });

    const merged = mergeEventsForSummary([composioEvent], [composioEvent]);

    expect(merged.filter((e) => e.id === "ev-composio-off").length).toBe(1);
  });
});
