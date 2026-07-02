/**
 * #798 — agent-loop run detail parity for Composio degradation visibility.
 *
 * Agent-loop runs have no persisted RunSummary (unlike background-agent
 * runs) — the run detail page renders directly from the already-loaded
 * `events` array. This pure function derives the same kind of human-readable
 * warning strings the background-agent run-summary.ts produces, scoped to
 * the loop-parity event names emitted by agent-step.ts
 * (agent-loop.step.composio.*).
 */
import { describe, expect, test } from "bun:test";
import type { AgentLoopEvent } from "@/lib/db/schema";
import { deriveLoopComposioWarnings } from "./composio-warnings";

function makeEvent(overrides: Partial<AgentLoopEvent> = {}): AgentLoopEvent {
  return {
    id: "evt-1",
    loopRunId: "loop-run-1",
    stepRunId: "step-run-1",
    nodeId: "agent-node-1",
    eventName: "agent-loop.step.agent.completed",
    status: "succeeded",
    level: "info",
    summary: null,
    payload: {},
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: "wf-run-1",
    createdAt: new Date("2026-05-27T12:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveLoopComposioWarnings", () => {
  test("BT-001: off event (no_slugs_selected) produces a warning line", () => {
    const events: AgentLoopEvent[] = [
      makeEvent({
        eventName: "agent-loop.step.composio.off",
        level: "warn",
        payload: { reason: "no_slugs_selected" },
      }),
    ];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toBeTruthy();
  });

  test("BT-002: off event (repo_policy_blocked) names the blocked slugs", () => {
    const events: AgentLoopEvent[] = [
      makeEvent({
        eventName: "agent-loop.step.composio.off",
        level: "warn",
        payload: { reason: "repo_policy_blocked", blockedSlugs: ["gmail"] },
      }),
    ];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings.some((w) => w.includes("gmail"))).toBe(true);
  });

  test("BT-003: error event includes the errorKind", () => {
    const events: AgentLoopEvent[] = [
      makeEvent({
        eventName: "agent-loop.step.composio.error",
        level: "warn",
        payload: { errorKind: "composio_missing_api_key" },
      }),
    ];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings.some((w) => w.includes("composio_missing_api_key"))).toBe(
      true,
    );
  });

  test("BT-004: not_connected event names the disconnected toolkits", () => {
    const events: AgentLoopEvent[] = [
      makeEvent({
        eventName: "agent-loop.step.composio.not_connected",
        level: "warn",
        payload: { disconnectedToolkits: ["slack", "gmail"] },
      }),
    ];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings.some((w) => w.includes("slack"))).toBe(true);
    expect(warnings.some((w) => w.includes("gmail"))).toBe(true);
  });

  test("BT-005 (scope guard): non-composio warn events do not produce warnings", () => {
    const events: AgentLoopEvent[] = [
      makeEvent({
        eventName: "agent-loop.step.commit.failed",
        level: "error",
        payload: {},
      }),
    ];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings).toHaveLength(0);
  });

  test("BT-006: no composio events at all -> empty warnings array (no false positives)", () => {
    const events: AgentLoopEvent[] = [makeEvent()];

    const warnings = deriveLoopComposioWarnings(events);

    expect(warnings).toHaveLength(0);
  });
});
