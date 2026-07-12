/**
 * use-run-graph-state.events.test.ts — BT-LOOPS-040 through BT-LOOPS-043
 *
 * Behavioral tests for event-based edge traversal derivation (Fix 1, PR #366).
 *
 * BT-LOOPS-040: When events contain agent-loop.edge.evaluated entries, ONLY the
 *   exact edgeId from those events is marked traversed (not by step-pair inference).
 * BT-LOOPS-041: When two parallel edges connect the same (source, target) pair with
 *   different `when` values and events attribute EXACTLY ONE, only that edge is
 *   traversed/mostRecent; the other stays untouched.
 * BT-LOOPS-042: mostRecent = the edgeId from the LAST edge.evaluated event
 *   (ordered by createdAt ascending).
 * BT-LOOPS-043: When events array has no edge.evaluated entries, the existing
 *   step-sequence fallback inference is used (backward compatibility).
 */

import { describe, expect, test } from "bun:test";
import { deriveRunGraphState, type RunGraphInput } from "./use-run-graph-state";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { AgentLoopEvent } from "@/lib/db/schema";

// ── Shared snapshot: condition node with two parallel edges (true + false)
// both looping back to node-a from node-b ──────────────────────────────────────

const PARALLEL_EDGE_SNAPSHOT: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "node-a",
      kind: "agent_step",
      label: "Agent",
      position: { x: 200, y: 0 },
    },
    {
      id: "node-b",
      kind: "condition",
      label: "Check",
      position: { x: 400, y: 0 },
    },
    { id: "end", kind: "end", label: "End", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e-start-a", source: "start", target: "node-a", when: "always" },
    { id: "e-a-b", source: "node-a", target: "node-b", when: "success" },
    // TWO parallel edges from node-b back to node-a:
    { id: "e-true-loop", source: "node-b", target: "node-a", when: "true" },
    { id: "e-false-loop", source: "node-b", target: "node-a", when: "false" },
    { id: "e-b-end", source: "node-b", target: "end", when: "success" },
  ],
};

// ── Helper to build a minimal AgentLoopEvent ───────────────────────────────────

function makeEdgeEvaluatedEvent(
  id: string,
  edgeId: string,
  nodeId: string,
  nextNodeId: string,
  createdAt: Date,
): AgentLoopEvent {
  return {
    id,
    loopRunId: "run-1",
    stepRunId: null,
    nodeId,
    eventName: "agent-loop.edge.evaluated",
    status: "info",
    level: "info",
    summary: `Edge evaluated: ${nodeId} → ${nextNodeId}`,
    payload: {
      nodeId,
      edgeId,
      outcome: "true",
      nextNodeId,
      iterationCount: 0,
      nodeKind: "condition",
    },
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: null,
    createdAt,
  };
}

function makeOtherEvent(id: string, createdAt: Date): AgentLoopEvent {
  return {
    id,
    loopRunId: "run-1",
    stepRunId: null,
    nodeId: "start",
    eventName: "agent-loop.run.started",
    status: "started",
    level: "info",
    summary: "Run started",
    payload: {},
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: null,
    createdAt,
  };
}

function makeStep(
  id: string,
  nodeId: string,
  createdAt: Date,
  status: "succeeded" | "running" | "failed" = "succeeded",
) {
  return {
    id,
    loopRunId: "run-1",
    nodeId,
    nodeKind: "agent_step",
    status,
    attempt: 1,
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt,
  };
}

function makeRun(currentNodeId: string | null = null) {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running" as const,
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    source: "manual" as const,
    workflowRunId: null,
    requestId: null,
    idempotencyKey: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── BT-LOOPS-040: Primary source = edge.evaluated events ─────────────────────

describe("BT-LOOPS-040: events as primary source for edge traversal", () => {
  test("when events contain edge.evaluated, edgeId from event is marked traversed", () => {
    const input: RunGraphInput = {
      definitionSnapshot: PARALLEL_EDGE_SNAPSHOT,
      steps: [
        makeStep("sr-start", "start", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-a", "node-a", new Date("2024-01-01T00:00:02Z")),
        makeStep("sr-b", "node-b", new Date("2024-01-01T00:00:03Z")),
      ],
      run: makeRun("node-a"),
      guardrails: null,
      events: [
        makeEdgeEvaluatedEvent(
          "ev-1",
          "e-start-a",
          "start",
          "node-a",
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeEdgeEvaluatedEvent(
          "ev-2",
          "e-a-b",
          "node-a",
          "node-b",
          new Date("2024-01-01T00:00:02Z"),
        ),
        // ONLY the true-loop edge was actually taken
        makeEdgeEvaluatedEvent(
          "ev-3",
          "e-true-loop",
          "node-b",
          "node-a",
          new Date("2024-01-01T00:00:03Z"),
        ),
      ],
    };

    const state = deriveRunGraphState(input);

    // The event says e-true-loop was traversed
    expect(state.edges["e-true-loop"]?.traversed).toBe(true);
    // e-false-loop was NOT in the events — must NOT be traversed
    expect(state.edges["e-false-loop"]?.traversed).toBe(false);
  });
});

// ── BT-LOOPS-041: Two parallel edges, events attribute exactly one ─────────────

describe("BT-LOOPS-041: parallel edges — events attribute exactly one, only that edge is traversed/mostRecent", () => {
  test("with two parallel edges (same source+target), only the event-attributed one is traversed", () => {
    const input: RunGraphInput = {
      definitionSnapshot: PARALLEL_EDGE_SNAPSHOT,
      steps: [
        makeStep("sr-start", "start", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-a", "node-a", new Date("2024-01-01T00:00:02Z")),
        makeStep("sr-b", "node-b", new Date("2024-01-01T00:00:03Z")),
        makeStep(
          "sr-a2",
          "node-a",
          new Date("2024-01-01T00:00:04Z"),
          "running",
        ),
      ],
      run: makeRun("node-a"),
      guardrails: null,
      events: [
        makeEdgeEvaluatedEvent(
          "ev-1",
          "e-start-a",
          "start",
          "node-a",
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeEdgeEvaluatedEvent(
          "ev-2",
          "e-a-b",
          "node-a",
          "node-b",
          new Date("2024-01-01T00:00:02Z"),
        ),
        // The true-loop edge was taken, NOT the false-loop edge
        makeEdgeEvaluatedEvent(
          "ev-3",
          "e-true-loop",
          "node-b",
          "node-a",
          new Date("2024-01-01T00:00:03Z"),
        ),
      ],
    };

    const state = deriveRunGraphState(input);

    // e-true-loop: traversed AND mostRecent (it's the last event)
    expect(state.edges["e-true-loop"]?.traversed).toBe(true);
    expect(state.edges["e-true-loop"]?.mostRecent).toBe(true);

    // e-false-loop: NEITHER traversed NOR mostRecent
    // (without events, step-pair inference would mark BOTH as traversed — the bug)
    expect(state.edges["e-false-loop"]?.traversed).toBe(false);
    expect(state.edges["e-false-loop"]?.mostRecent).toBe(false);
  });
});

// ── BT-LOOPS-042: mostRecent = last edge.evaluated event's edgeId ─────────────

describe("BT-LOOPS-042: mostRecent is the edgeId from the last edge.evaluated event", () => {
  test("last edge.evaluated event by createdAt determines mostRecent edge", () => {
    const LINEAR_SNAPSHOT: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step-a",
          kind: "agent_step",
          label: "A",
          position: { x: 200, y: 0 },
        },
        {
          id: "step-b",
          kind: "agent_step",
          label: "B",
          position: { x: 400, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 600, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "step-a", when: "always" },
        { id: "e2", source: "step-a", target: "step-b", when: "success" },
        { id: "e3", source: "step-b", target: "end", when: "success" },
      ],
    };

    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [],
      run: makeRun(null),
      guardrails: null,
      events: [
        makeEdgeEvaluatedEvent(
          "ev-1",
          "e1",
          "start",
          "step-a",
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeEdgeEvaluatedEvent(
          "ev-2",
          "e2",
          "step-a",
          "step-b",
          new Date("2024-01-01T00:00:02Z"),
        ),
        makeEdgeEvaluatedEvent(
          "ev-3",
          "e3",
          "step-b",
          "end",
          new Date("2024-01-01T00:00:03Z"),
        ),
      ],
    };

    const state = deriveRunGraphState(input);

    // All three traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    expect(state.edges["e2"]?.traversed).toBe(true);
    expect(state.edges["e3"]?.traversed).toBe(true);

    // Only e3 (last event) is mostRecent
    expect(state.edges["e3"]?.mostRecent).toBe(true);
    expect(state.edges["e1"]?.mostRecent).toBe(false);
    expect(state.edges["e2"]?.mostRecent).toBe(false);
  });

  test("non-edge.evaluated events are ignored for traversal", () => {
    const SIMPLE_SNAPSHOT: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
    };

    const input: RunGraphInput = {
      definitionSnapshot: SIMPLE_SNAPSHOT,
      steps: [],
      run: makeRun(null),
      guardrails: null,
      events: [
        makeOtherEvent("ev-other", new Date("2024-01-01T00:00:01Z")),
        // no edge.evaluated events
      ],
    };

    const state = deriveRunGraphState(input);
    // No edge.evaluated events → edge is not traversed (fallback to steps, but steps is empty too)
    expect(state.edges["e1"]?.traversed).toBe(false);
  });
});

// ── BT-LOOPS-043: Fallback when no edge.evaluated events ──────────────────────

describe("BT-LOOPS-043: fallback to step-sequence when no edge.evaluated events in events array", () => {
  test("when events is empty, step-sequence inference is used (backward compat)", () => {
    const SIMPLE_SNAPSHOT: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step-a",
          kind: "agent_step",
          label: "A",
          position: { x: 200, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "step-a", when: "always" },
        { id: "e2", source: "step-a", target: "end", when: "success" },
      ],
    };

    const input: RunGraphInput = {
      definitionSnapshot: SIMPLE_SNAPSHOT,
      steps: [
        makeStep("sr-1", "start", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-2", "step-a", new Date("2024-01-01T00:00:02Z")),
      ],
      run: makeRun("step-a"),
      guardrails: null,
      events: [], // no edge.evaluated events — fall back to step-sequence
    };

    const state = deriveRunGraphState(input);
    // Step-sequence inference: start → step-a → e1 traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    expect(state.edges["e2"]?.traversed).toBe(false);
  });

  test("when events is undefined, step-sequence inference is used", () => {
    const SIMPLE_SNAPSHOT: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step-a",
          kind: "agent_step",
          label: "A",
          position: { x: 200, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "step-a", when: "always" },
        { id: "e2", source: "step-a", target: "end", when: "success" },
      ],
    };

    // No events field at all — undefined
    const input = {
      definitionSnapshot: SIMPLE_SNAPSHOT,
      steps: [
        makeStep("sr-1", "start", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-2", "step-a", new Date("2024-01-01T00:00:02Z")),
      ],
      run: makeRun("step-a"),
      guardrails: null,
    } as RunGraphInput;

    const state = deriveRunGraphState(input);
    // Still works via fallback
    expect(state.edges["e1"]?.traversed).toBe(true);
  });
});
