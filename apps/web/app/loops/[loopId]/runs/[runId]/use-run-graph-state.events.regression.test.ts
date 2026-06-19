/**
 * use-run-graph-state.events.regression.test.ts — TASK-366 regression harness
 *
 * These tests catch specific scenarios that would break if:
 *   - The events-first path is removed (falls back to step inference for all runs)
 *   - The edgeId field is not read from event payload
 *   - The mostRecent derivation reverts to step-sequence index instead of last event
 *   - The fallback is removed (runs without edge.evaluated events lose traversal)
 *   - The parallel-edge disambiguation is removed (both parallel edges marked traversed)
 *
 * Regression scenarios:
 *   R1. Parallel edges with events: removing event path marks BOTH parallel edges
 *       traversed (the original bug). Test ensures ONLY the event-attributed edge is marked.
 *   R2. If edgeId extraction from payload is broken, no edge is marked traversed even
 *       though events are present.
 *   R3. mostRecent tracks event order (last event = most recent), not arbitrary step order.
 *   R4. Fallback intact: if event-first path is also run for runs with no events, step
 *       inference still produces correct results.
 *   R5. Edge not in snapshot: if an event references an edgeId that is not in the
 *       snapshot definition, it is silently skipped — no crash.
 */

import { describe, expect, it } from "bun:test";
import { deriveRunGraphState, type RunGraphInput } from "./use-run-graph-state";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { AgentLoopEvent } from "@/lib/db/schema";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PARALLEL_SNAPSHOT: LoopDefinition = {
  nodes: [
    { id: "src", kind: "start", label: "Src", position: { x: 0, y: 0 } },
    { id: "tgt", kind: "end", label: "Tgt", position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: "e-true", source: "src", target: "tgt", when: "true" },
    { id: "e-false", source: "src", target: "tgt", when: "false" },
  ],
};

const LINEAR_SNAPSHOT: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
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
    { id: "end", kind: "end", label: "E", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "step-a", when: "always" },
    { id: "e2", source: "step-a", target: "step-b", when: "success" },
    { id: "e3", source: "step-b", target: "end", when: "success" },
  ],
};

function makeEdgeEvent(
  id: string,
  edgeId: string,
  createdAt: Date,
): AgentLoopEvent {
  return {
    id,
    loopRunId: "run-1",
    stepRunId: null,
    nodeId: "src",
    eventName: "agent-loop.edge.evaluated",
    status: "info",
    level: "info",
    summary: "edge evaluated",
    payload: {
      nodeId: "src",
      edgeId,
      outcome: "true",
      nextNodeId: "tgt",
      iterationCount: 0,
      nodeKind: "condition",
    },
    redactionStatus: "passed",
    requestId: null,
    workflowRunId: null,
    createdAt,
  };
}

function makeStep(id: string, nodeId: string, createdAt: Date) {
  return {
    id,
    loopRunId: "run-1",
    nodeId,
    nodeKind: "agent_step",
    status: "succeeded" as const,
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

function makeRun() {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: "running" as const,
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {} as Record<string, unknown>,
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

// ── R1: Parallel edges disambiguation ────────────────────────────────────────

describe("regression R1: if event-path removed, BOTH parallel edges would be traversed (original bug)", () => {
  it("regression: with events, ONLY the event-attributed parallel edge is marked traversed", () => {
    // If this test fails, it means the event-based path was removed and step
    // inference runs, which marks both e-true and e-false as traversed.
    const input: RunGraphInput = {
      definitionSnapshot: PARALLEL_SNAPSHOT,
      steps: [
        makeStep("sr-1", "src", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-2", "tgt", new Date("2024-01-01T00:00:02Z")),
      ],
      run: makeRun(),
      guardrails: null,
      events: [
        makeEdgeEvent("ev-1", "e-true", new Date("2024-01-01T00:00:01Z")),
      ],
    };

    const state = deriveRunGraphState(input);

    // ONLY e-true must be traversed
    expect(state.edges["e-true"]?.traversed).toBe(true);
    // e-false must NOT be traversed — this is the core regression guard
    expect(state.edges["e-false"]?.traversed).toBe(false);
    expect(state.edges["e-false"]?.mostRecent).toBe(false);
  });
});

// ── R2: edgeId extraction from payload ───────────────────────────────────────

describe("regression R2: if edgeId extraction broken, edges remain un-traversed despite events", () => {
  it("regression: events with valid edgeId payload produce traversed=true", () => {
    // If edgeId extraction from payload breaks, this test fails because
    // traversed stays false despite events being present.
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [],
      run: makeRun(),
      guardrails: null,
      events: [
        makeEdgeEvent("ev-1", "e1", new Date("2024-01-01T00:00:01Z")),
        makeEdgeEvent("ev-2", "e2", new Date("2024-01-01T00:00:02Z")),
      ],
    };

    const state = deriveRunGraphState(input);

    expect(state.edges["e1"]?.traversed).toBe(true);
    expect(state.edges["e2"]?.traversed).toBe(true);
    // e3 had no event — stays un-traversed
    expect(state.edges["e3"]?.traversed).toBe(false);
  });
});

// ── R3: mostRecent tracks event order ────────────────────────────────────────

describe("regression R3: mostRecent is the LAST edge.evaluated event by createdAt", () => {
  it("regression: if event ordering breaks, mostRecent would be wrong edge", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [],
      run: makeRun(),
      guardrails: null,
      events: [
        // Intentionally out of createdAt order in the array to test sorting
        makeEdgeEvent("ev-3", "e3", new Date("2024-01-01T00:00:03Z")),
        makeEdgeEvent("ev-1", "e1", new Date("2024-01-01T00:00:01Z")),
        makeEdgeEvent("ev-2", "e2", new Date("2024-01-01T00:00:02Z")),
      ],
    };

    const state = deriveRunGraphState(input);

    // Sorted by createdAt: ev-1(e1) → ev-2(e2) → ev-3(e3)
    // Last event is ev-3 → e3 is mostRecent
    expect(state.edges["e3"]?.mostRecent).toBe(true);
    expect(state.edges["e1"]?.mostRecent).toBe(false);
    expect(state.edges["e2"]?.mostRecent).toBe(false);
  });
});

// ── R4: Fallback still works when no edge.evaluated events ────────────────────

describe("regression R4: fallback to step-sequence intact when events has no edge.evaluated", () => {
  it("regression: if fallback removed, runs without events have no traversal data", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep("sr-1", "start", new Date("2024-01-01T00:00:01Z")),
        makeStep("sr-2", "step-a", new Date("2024-01-01T00:00:02Z")),
      ],
      run: makeRun(),
      guardrails: null,
      events: [], // empty — no edge.evaluated events
    };

    const state = deriveRunGraphState(input);

    // Fallback: step-sequence: start→step-a → e1 traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    // No step after step-a → e2 not traversed
    expect(state.edges["e2"]?.traversed).toBe(false);
  });
});

// ── R5: Unknown edgeId in event payload doesn't crash ─────────────────────────

describe("regression R5: events referencing unknown edgeId are silently skipped", () => {
  it("regression: dangling edgeId in event payload does not crash or produce incorrect state", () => {
    const badEvent: AgentLoopEvent = {
      id: "ev-bad",
      loopRunId: "run-1",
      stepRunId: null,
      nodeId: "src",
      eventName: "agent-loop.edge.evaluated",
      status: "info",
      level: "info",
      summary: "edge evaluated",
      payload: { edgeId: "does-not-exist-in-snapshot" },
      redactionStatus: "passed",
      requestId: null,
      workflowRunId: null,
      createdAt: new Date("2024-01-01T00:00:01Z"),
    };

    const input: RunGraphInput = {
      definitionSnapshot: PARALLEL_SNAPSHOT,
      steps: [],
      run: makeRun(),
      guardrails: null,
      events: [badEvent],
    };

    // Should not throw; all edges remain un-traversed
    expect(() => deriveRunGraphState(input)).not.toThrow();
    const state = deriveRunGraphState(input);
    expect(state.edges["e-true"]?.traversed).toBe(false);
    expect(state.edges["e-false"]?.traversed).toBe(false);
  });
});
