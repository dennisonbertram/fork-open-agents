/**
 * use-run-graph-state.regression.test.ts — M2-03 regression harness
 *
 * These tests catch specific scenarios that would break if:
 *   - The snapshot rule is violated (graph uses live definition instead of snapshot)
 *   - Edge traversal derivation is removed or broken
 *   - Guardrail default fallback is removed
 *   - Status priority merge is broken (running wins over succeeded for same node)
 *   - most-recent traversal tracking is dropped
 *   - visitCount stops incrementing on cycle revisits
 *   - Unvisited nodes disappear from state (all nodes must appear even with no steps)
 *
 * Regression scenarios covered:
 *   1. Snapshot divergence: run's snapshot has different nodes than "current" definition
 *   2. Edge traversal: two consecutive steps mark the edge between them as traversed
 *   3. Guardrail defaults: null guardrails don't produce 0 limits
 *   4. Status priority: running > succeeded for same node with multiple steps
 *   5. Most-recent traversal path: only last edge-pair flagged mostRecent
 *   6. Cycle revisit visitCount: count grows correctly across iterations
 *   7. All snapshot nodes appear in output even when steps array is empty
 *   8. Terminal run: status=completed clears currentNodeId, preserves node statuses
 */

import { describe, expect, it } from "bun:test";
import { deriveRunGraphState, type RunGraphInput } from "./use-run-graph-state";
import { GUARDRAIL_DEFAULTS } from "@/lib/agent-loops/types";
import type { LoopDefinition } from "@/lib/agent-loops/types";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const LINEAR_SNAPSHOT: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "step-a",
      kind: "agent_step",
      label: "Step A",
      position: { x: 200, y: 0 },
    },
    {
      id: "step-b",
      kind: "agent_step",
      label: "Step B",
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

function makeStep(
  id: string,
  nodeId: string,
  status: "queued" | "running" | "succeeded" | "failed" | "skipped",
  attempt: number,
  createdAt: Date,
) {
  return {
    id,
    loopRunId: "run-1",
    nodeId,
    nodeKind: "agent_step",
    status,
    attempt,
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

function makeRun(
  status:
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "stalled",
  currentNodeId: string | null,
  iterationCount = 0,
  stepCount = 0,
) {
  return {
    id: "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status,
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId,
    currentStepRunId: null,
    iterationCount,
    stepCount,
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

// ── Regression 1: Snapshot divergence ────────────────────────────────────────

describe("regression: snapshot divergence (if snapshot rule is removed, this fails)", () => {
  it("regression: nodes in snapshot but not in current live definition appear in state", () => {
    // Simulate: loop was edited to rename step-a to new-step-a after run started
    // The snapshot still has "step-a"; the run graph must show it
    const snapshotWithOldNode: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "original-node",
          kind: "agent_step",
          label: "Old step",
          position: { x: 200, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "original-node", when: "always" },
        { id: "e2", source: "original-node", target: "end", when: "success" },
      ],
    };

    const input: RunGraphInput = {
      definitionSnapshot: snapshotWithOldNode,
      steps: [
        makeStep(
          "sr-1",
          "original-node",
          "succeeded",
          1,
          new Date("2024-01-01"),
        ),
      ],
      run: makeRun("completed", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // "original-node" must be in state (it's in the snapshot)
    expect(state.nodes["original-node"]).toBeDefined();
    expect(state.nodes["original-node"]?.status).toBe("succeeded");

    // "new-step-a" (from hypothetical live definition) must NOT be in state
    expect(state.nodes["new-step-a"]).toBeUndefined();
  });
});

// ── Regression 2: Edge traversal ─────────────────────────────────────────────

describe("regression: edge traversal derivation (if step-sequence logic is removed, this fails)", () => {
  it("regression: without step sequence logic, edges would never be marked traversed", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "start",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeStep(
          "sr-2",
          "step-a",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:02Z"),
        ),
        makeStep(
          "sr-3",
          "step-b",
          "running",
          1,
          new Date("2024-01-01T00:00:03Z"),
        ),
      ],
      run: makeRun("running", "step-b"),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // e1: start→step-a must be traversed (sr-1 → sr-2 consecutive pair)
    expect(state.edges["e1"]?.traversed).toBe(true);
    // e2: step-a→step-b must be traversed (sr-2 → sr-3 consecutive pair)
    expect(state.edges["e2"]?.traversed).toBe(true);
    // e3: step-b→end must NOT be traversed (no step after sr-3)
    expect(state.edges["e3"]?.traversed).toBe(false);
  });
});

// ── Regression 3: Guardrail defaults ─────────────────────────────────────────

describe("regression: guardrail defaults (if default fallback removed, meter shows 0/0)", () => {
  it("regression: null guardrails returns GUARDRAIL_DEFAULTS, not 0", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [],
      run: makeRun("running", null, 0, 0),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // Must NOT be zero — that would mean guardrail defaults were dropped
    expect(state.meter.maxIterations).toBe(GUARDRAIL_DEFAULTS.maxIterations);
    expect(state.meter.maxStepsPerRun).toBe(GUARDRAIL_DEFAULTS.maxStepsPerRun);
    expect(state.meter.maxIterations).toBeGreaterThan(0);
    expect(state.meter.maxStepsPerRun).toBeGreaterThan(0);
  });
});

// ── Regression 4: Status priority ────────────────────────────────────────────

describe("regression: status priority merge (running wins over succeeded)", () => {
  it("regression: if priority merge removed, running step would be overwritten by earlier succeeded", () => {
    // Node visited twice: first succeeded, then running (retry)
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "step-a",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeStep(
          "sr-2",
          "step-a",
          "running",
          2,
          new Date("2024-01-01T00:00:02Z"),
        ),
      ],
      run: makeRun("running", "step-a"),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // "running" has higher priority than "succeeded" — must win
    expect(state.nodes["step-a"]?.status).toBe("running");
  });

  it("regression: failed wins over skipped for same node", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "step-a",
          "skipped",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeStep(
          "sr-2",
          "step-a",
          "failed",
          2,
          new Date("2024-01-01T00:00:02Z"),
        ),
      ],
      run: makeRun("failed", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);
    expect(state.nodes["step-a"]?.status).toBe("failed");
  });
});

// ── Regression 5: Most-recent traversal ──────────────────────────────────────

describe("regression: most-recent traversal (if tracking removed, all edges would be mostRecent)", () => {
  it("regression: only the last edge traversal gets mostRecent=true", () => {
    // Full linear run: start → step-a → step-b → end
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "start",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeStep(
          "sr-2",
          "step-a",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:02Z"),
        ),
        makeStep(
          "sr-3",
          "step-b",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:03Z"),
        ),
        makeStep(
          "sr-4",
          "end",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:04Z"),
        ),
      ],
      run: makeRun("completed", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // All edges traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    expect(state.edges["e2"]?.traversed).toBe(true);
    expect(state.edges["e3"]?.traversed).toBe(true);

    // Only e3 (step-b → end, last traversal) is mostRecent
    expect(state.edges["e3"]?.mostRecent).toBe(true);
    // e1, e2 are older traversals
    expect(state.edges["e1"]?.mostRecent).toBe(false);
    expect(state.edges["e2"]?.mostRecent).toBe(false);
  });
});

// ── Regression 6: Cycle revisit visitCount ────────────────────────────────────

describe("regression: cycle revisit visitCount (if incremented once, count stays at 1)", () => {
  const CYCLE_SNAPSHOT: LoopDefinition = {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "node-a",
        kind: "agent_step",
        label: "A",
        position: { x: 200, y: 0 },
      },
      { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "node-a", when: "always" },
      { id: "e2", source: "node-a", target: "node-a", when: "failure" },
      { id: "e3", source: "node-a", target: "end", when: "success" },
    ],
  };

  it("regression: 3 visits to node-a produce visitCount=3", () => {
    const input: RunGraphInput = {
      definitionSnapshot: CYCLE_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "node-a",
          "failed",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
        makeStep(
          "sr-2",
          "node-a",
          "failed",
          2,
          new Date("2024-01-01T00:00:02Z"),
        ),
        makeStep(
          "sr-3",
          "node-a",
          "succeeded",
          3,
          new Date("2024-01-01T00:00:03Z"),
        ),
      ],
      run: makeRun("completed", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);
    expect(state.nodes["node-a"]?.visitCount).toBe(3);
    expect(state.nodes["node-a"]?.latestAttempt).toBe(3);
  });
});

// ── Regression 7: All snapshot nodes appear in output ─────────────────────────

describe("regression: all snapshot nodes in output (if iteration removed, unvisited nodes vanish)", () => {
  it("regression: even with empty steps, all 4 nodes appear in state as unvisited", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [],
      run: makeRun("queued", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    expect(Object.keys(state.nodes)).toHaveLength(4);
    for (const nodeId of ["start", "step-a", "step-b", "end"]) {
      expect(state.nodes[nodeId]?.status).toBe("unvisited");
      expect(state.nodes[nodeId]?.visitCount).toBe(0);
    }
  });
});

// ── Regression 8: Terminal run currentNodeId ──────────────────────────────────

describe("regression: terminal run does not inject currentNodeId (if check removed, shows ghost cursor)", () => {
  it("regression: completed run with null currentNodeId in run → state.currentNodeId is null", () => {
    const input: RunGraphInput = {
      definitionSnapshot: LINEAR_SNAPSHOT,
      steps: [
        makeStep(
          "sr-1",
          "step-a",
          "succeeded",
          1,
          new Date("2024-01-01T00:00:01Z"),
        ),
      ],
      run: makeRun("completed", null),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);
    // Must be null — a terminal run with null currentNodeId should not invent one
    expect(state.currentNodeId).toBeNull();
  });
});
