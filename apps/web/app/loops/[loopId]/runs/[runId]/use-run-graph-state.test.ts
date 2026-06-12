/**
 * use-run-graph-state.test.ts — M2-03 live run graph state derivation tests
 *
 * Behavior contract (BT-LOOPS-020 through BT-LOOPS-031):
 *   BT-LOOPS-020: Unvisited nodes have status "unvisited"
 *   BT-LOOPS-021: A running step produces nodeStatus "running"
 *   BT-LOOPS-022: A succeeded step produces nodeStatus "succeeded"
 *   BT-LOOPS-023: A failed step produces nodeStatus "failed"
 *   BT-LOOPS-024: A skipped step produces nodeStatus "skipped"
 *   BT-LOOPS-025: visitCount equals number of steps for that nodeId
 *   BT-LOOPS-026: latestAttempt equals the max attempt number across steps for a node
 *   BT-LOOPS-027: Cycle revisit — visitCount > 1 shows correct count; most-recent traversal edge highlighted
 *   BT-LOOPS-028: currentNodeId is surfaced from the run
 *   BT-LOOPS-029: Guardrail meter values from run + guardrails
 *   BT-LOOPS-030 (SNAPSHOT RULE): derivation uses definitionSnapshot, not the live definition
 *   BT-LOOPS-031: Terminal run — no currentNodeId override
 *   BT-LOOPS-032: Edge traversal — consecutive steps imply traversed edge between their nodes
 *   BT-LOOPS-033: Most-recent traversal path is flagged distinctly
 *   BT-LOOPS-034: Node identity is stable across poll updates when nothing changed
 */

import { describe, expect, test } from "bun:test";
import {
  deriveRunGraphState,
  type RunGraphInput,
} from "./use-run-graph-state";
import type { LoopDefinition } from "@/lib/agent-loops/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal snapshot: start → agent_step → end */
const snapshot: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "step-1",
      kind: "agent_step",
      label: "Implement",
      position: { x: 200, y: 0 },
    },
    { id: "end", kind: "end", label: "End", position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "step-1", when: "always" },
    { id: "e2", source: "step-1", target: "end", when: "success" },
  ],
};

/** Snapshot with a cycle: start → a → b → a (cycle back) → end */
const cycleSnapshot: LoopDefinition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "node-a",
      kind: "agent_step",
      label: "A",
      position: { x: 200, y: 0 },
    },
    {
      id: "node-b",
      kind: "agent_step",
      label: "B",
      position: { x: 400, y: 0 },
    },
    { id: "end", kind: "end", label: "End", position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "node-a", when: "always" },
    { id: "e2", source: "node-a", target: "node-b", when: "always" },
    { id: "e3", source: "node-b", target: "node-a", when: "failure" },
    { id: "e4", source: "node-b", target: "end", when: "success" },
  ],
};

function makeStep(
  overrides: Partial<{
    id: string;
    nodeId: string;
    nodeKind: string;
    status: "queued" | "running" | "succeeded" | "failed" | "skipped";
    attempt: number;
    createdAt: Date;
  }>,
) {
  return {
    id: overrides.id ?? "sr-1",
    loopRunId: "run-1",
    nodeId: overrides.nodeId ?? "step-1",
    nodeKind: overrides.nodeKind ?? "agent_step",
    status: overrides.status ?? "succeeded",
    attempt: overrides.attempt ?? 1,
    stepInput: null,
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: overrides.createdAt ?? new Date("2024-01-01T00:00:00Z"),
  };
}

function makeRun(
  overrides: Partial<{
    id: string;
    status:
      | "queued"
      | "running"
      | "paused"
      | "completed"
      | "failed"
      | "cancelled"
      | "stalled";
    currentNodeId: string | null;
    iterationCount: number;
    stepCount: number;
  }>,
) {
  return {
    id: overrides.id ?? "run-1",
    loopId: "loop-1",
    userId: "user-1",
    status: overrides.status ?? "running",
    definitionSnapshot: {} as Record<string, unknown>,
    currentNodeId: overrides.currentNodeId ?? null,
    currentStepRunId: null,
    iterationCount: overrides.iterationCount ?? 0,
    stepCount: overrides.stepCount ?? 0,
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

// ── BT-LOOPS-020: Unvisited nodes ─────────────────────────────────────────────

describe("BT-LOOPS-020: unvisited nodes", () => {
  test("nodes with no steps have status 'unvisited'", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [],
      run: makeRun({ currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["start"]?.status).toBe("unvisited");
    expect(state.nodes["step-1"]?.status).toBe("unvisited");
    expect(state.nodes["end"]?.status).toBe("unvisited");
  });
});

// ── BT-LOOPS-021: Running step ────────────────────────────────────────────────

describe("BT-LOOPS-021: running step maps to nodeStatus running", () => {
  test("a running step produces nodeStatus 'running'", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "running" })],
      run: makeRun({ currentNodeId: "step-1" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["step-1"]?.status).toBe("running");
  });
});

// ── BT-LOOPS-022: Succeeded step ──────────────────────────────────────────────

describe("BT-LOOPS-022: succeeded step", () => {
  test("a succeeded step produces nodeStatus 'succeeded'", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "succeeded" })],
      run: makeRun({ currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["step-1"]?.status).toBe("succeeded");
  });
});

// ── BT-LOOPS-023: Failed step ─────────────────────────────────────────────────

describe("BT-LOOPS-023: failed step", () => {
  test("a failed step produces nodeStatus 'failed'", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "failed" })],
      run: makeRun({ currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["step-1"]?.status).toBe("failed");
  });
});

// ── BT-LOOPS-024: Skipped step ────────────────────────────────────────────────

describe("BT-LOOPS-024: skipped step", () => {
  test("a skipped step produces nodeStatus 'skipped'", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "skipped" })],
      run: makeRun({ currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["step-1"]?.status).toBe("skipped");
  });
});

// ── BT-LOOPS-025: visitCount ──────────────────────────────────────────────────

describe("BT-LOOPS-025: visitCount", () => {
  test("visitCount equals number of steps for a nodeId", () => {
    const input: RunGraphInput = {
      definitionSnapshot: cycleSnapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "node-a",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "node-b",
          status: "failed",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:02Z"),
        }),
        makeStep({
          id: "sr-3",
          nodeId: "node-a",
          status: "running",
          attempt: 2,
          createdAt: new Date("2024-01-01T00:00:03Z"),
        }),
      ],
      run: makeRun({ currentNodeId: "node-a" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["node-a"]?.visitCount).toBe(2);
    expect(state.nodes["node-b"]?.visitCount).toBe(1);
  });
});

// ── BT-LOOPS-026: latestAttempt ───────────────────────────────────────────────

describe("BT-LOOPS-026: latestAttempt", () => {
  test("latestAttempt equals max attempt for a node", () => {
    const input: RunGraphInput = {
      definitionSnapshot: cycleSnapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "node-a",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "node-a",
          status: "running",
          attempt: 3,
          createdAt: new Date("2024-01-01T00:00:03Z"),
        }),
      ],
      run: makeRun({ currentNodeId: "node-a" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["node-a"]?.latestAttempt).toBe(3);
  });
});

// ── BT-LOOPS-027: Cycle revisit ───────────────────────────────────────────────

describe("BT-LOOPS-027: cycle revisit", () => {
  test("visitCount > 1 for revisited nodes in a cycle", () => {
    const input: RunGraphInput = {
      definitionSnapshot: cycleSnapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "start",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "node-a",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:02Z"),
        }),
        makeStep({
          id: "sr-3",
          nodeId: "node-b",
          status: "failed",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:03Z"),
        }),
        makeStep({
          id: "sr-4",
          nodeId: "node-a",
          status: "succeeded",
          attempt: 2,
          createdAt: new Date("2024-01-01T00:00:04Z"),
        }),
        makeStep({
          id: "sr-5",
          nodeId: "node-b",
          status: "succeeded",
          attempt: 2,
          createdAt: new Date("2024-01-01T00:00:05Z"),
        }),
      ],
      run: makeRun({ currentNodeId: null, status: "completed" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    // node-a visited twice, node-b visited twice
    expect(state.nodes["node-a"]?.visitCount).toBe(2);
    expect(state.nodes["node-b"]?.visitCount).toBe(2);
  });

  test("most-recent traversal path edges are flagged as mostRecent=true", () => {
    const input: RunGraphInput = {
      definitionSnapshot: cycleSnapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "start",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "node-a",
          status: "succeeded",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:02Z"),
        }),
        makeStep({
          id: "sr-3",
          nodeId: "node-b",
          status: "failed",
          attempt: 1,
          createdAt: new Date("2024-01-01T00:00:03Z"),
        }),
        makeStep({
          id: "sr-4",
          nodeId: "node-a",
          status: "running",
          attempt: 2,
          createdAt: new Date("2024-01-01T00:00:04Z"),
        }),
      ],
      run: makeRun({ currentNodeId: "node-a" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    // The most-recent traversal: node-b → node-a (e3: failure edge)
    // e3 connects node-b → node-a; after sr-3 (node-b) → sr-4 (node-a)
    const e3 = state.edges["e3"];
    expect(e3?.traversed).toBe(true);
    expect(e3?.mostRecent).toBe(true);
  });
});

// ── BT-LOOPS-028: currentNodeId ───────────────────────────────────────────────

describe("BT-LOOPS-028: currentNodeId surfaced from run", () => {
  test("currentNodeId matches run.currentNodeId", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "running" })],
      run: makeRun({ currentNodeId: "step-1" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.currentNodeId).toBe("step-1");
  });

  test("currentNodeId is null for terminal runs", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "succeeded" })],
      run: makeRun({ currentNodeId: null, status: "completed" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.currentNodeId).toBeNull();
  });
});

// ── BT-LOOPS-029: Guardrail meter ─────────────────────────────────────────────

describe("BT-LOOPS-029: guardrail meter values", () => {
  test("iterationCount and maxIterations are surfaced", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [],
      run: makeRun({ iterationCount: 2, stepCount: 5 }),
      guardrails: { maxIterations: 10, maxStepsPerRun: 50 },
    };
    const state = deriveRunGraphState(input);
    expect(state.meter.iterationCount).toBe(2);
    expect(state.meter.maxIterations).toBe(10);
    expect(state.meter.stepCount).toBe(5);
    expect(state.meter.maxStepsPerRun).toBe(50);
  });

  test("falls back to defaults when guardrails is null", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [],
      run: makeRun({ iterationCount: 1, stepCount: 3 }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.meter.iterationCount).toBe(1);
    // GUARDRAIL_DEFAULTS.maxIterations = 10
    expect(state.meter.maxIterations).toBe(10);
    expect(state.meter.stepCount).toBe(3);
    // GUARDRAIL_DEFAULTS.maxStepsPerRun = 50
    expect(state.meter.maxStepsPerRun).toBe(50);
  });
});

// ── BT-LOOPS-030: SNAPSHOT RULE ───────────────────────────────────────────────

describe("BT-LOOPS-030: snapshot rule — graph uses definitionSnapshot, never current definition", () => {
  test("divergence: snapshot has node-A, current definition has node-B; state uses snapshot nodes", () => {
    // Simulate an edited loop where the snapshot has "original-step"
    // but the loop's current definition would have "new-step"
    const olderSnapshot: LoopDefinition = {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "original-step",
          kind: "agent_step",
          label: "Original",
          position: { x: 200, y: 0 },
        },
        {
          id: "end",
          kind: "end",
          label: "End",
          position: { x: 400, y: 0 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "start",
          target: "original-step",
          when: "always",
        },
        { id: "e2", source: "original-step", target: "end", when: "success" },
      ],
    };

    const input: RunGraphInput = {
      definitionSnapshot: olderSnapshot,
      steps: [makeStep({ nodeId: "original-step", status: "succeeded" })],
      run: makeRun({ currentNodeId: null }),
      guardrails: null,
    };

    const state = deriveRunGraphState(input);

    // State has nodes from the SNAPSHOT — "original-step" exists
    expect(state.nodes["original-step"]).toBeDefined();
    // "new-step" does not exist in snapshot, so not in state
    expect(state.nodes["new-step"]).toBeUndefined();
  });
});

// ── BT-LOOPS-031: Terminal run ────────────────────────────────────────────────

describe("BT-LOOPS-031: terminal run static render", () => {
  test("completed run: all nodes have terminal status, no currentNodeId", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [
        makeStep({ nodeId: "step-1", status: "succeeded" }),
        makeStep({ id: "sr-2", nodeId: "end", status: "succeeded" }),
      ],
      run: makeRun({ status: "completed", currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.currentNodeId).toBeNull();
    expect(state.nodes["step-1"]?.status).toBe("succeeded");
  });

  test("failed run: failed node correctly flagged", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "failed" })],
      run: makeRun({ status: "failed", currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    expect(state.nodes["step-1"]?.status).toBe("failed");
    expect(state.currentNodeId).toBeNull();
  });
});

// ── BT-LOOPS-032: Edge traversal from step sequence ──────────────────────────

describe("BT-LOOPS-032: edge traversal from step sequence", () => {
  test("consecutive steps imply the edge between their nodes is traversed", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "start",
          status: "succeeded",
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "step-1",
          status: "running",
          createdAt: new Date("2024-01-01T00:00:02Z"),
        }),
      ],
      run: makeRun({ currentNodeId: "step-1" }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    // e1: start → step-1, should be traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    // e2: step-1 → end, NOT yet traversed
    expect(state.edges["e2"]?.traversed).toBe(false);
  });
});

// ── BT-LOOPS-033: Most-recent traversal path ─────────────────────────────────

describe("BT-LOOPS-033: most-recent traversal path", () => {
  test("only the last traversal of each edge-pair is marked mostRecent", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [
        makeStep({
          id: "sr-1",
          nodeId: "start",
          status: "succeeded",
          createdAt: new Date("2024-01-01T00:00:01Z"),
        }),
        makeStep({
          id: "sr-2",
          nodeId: "step-1",
          status: "succeeded",
          createdAt: new Date("2024-01-01T00:00:02Z"),
        }),
        makeStep({
          id: "sr-3",
          nodeId: "end",
          status: "succeeded",
          createdAt: new Date("2024-01-01T00:00:03Z"),
        }),
      ],
      run: makeRun({ status: "completed", currentNodeId: null }),
      guardrails: null,
    };
    const state = deriveRunGraphState(input);
    // All edges should be traversed
    expect(state.edges["e1"]?.traversed).toBe(true);
    expect(state.edges["e2"]?.traversed).toBe(true);
    // The most-recent path is the full path from last steps
    // e2 (step-1 → end) is the most recent traversal
    expect(state.edges["e2"]?.mostRecent).toBe(true);
  });
});

// ── BT-LOOPS-034: Node identity stability ─────────────────────────────────────

describe("BT-LOOPS-034: node identity stability across poll updates", () => {
  test("when nothing changes, node object references are stable (same derivation input → same output shape)", () => {
    const input: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "running" })],
      run: makeRun({ currentNodeId: "step-1" }),
      guardrails: null,
    };
    const state1 = deriveRunGraphState(input);
    const state2 = deriveRunGraphState(input);
    // Same derivation input must produce deeply-equal output
    expect(state1.nodes["step-1"]?.status).toBe(state2.nodes["step-1"]?.status);
    expect(state1.nodes["step-1"]?.visitCount).toBe(
      state2.nodes["step-1"]?.visitCount,
    );
    expect(state1.currentNodeId).toBe(state2.currentNodeId);
  });

  test("when a step status changes, derivation reflects new status", () => {
    const input1: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "running" })],
      run: makeRun({ currentNodeId: "step-1" }),
      guardrails: null,
    };
    const input2: RunGraphInput = {
      definitionSnapshot: snapshot,
      steps: [makeStep({ nodeId: "step-1", status: "succeeded" })],
      run: makeRun({ currentNodeId: null, status: "completed" }),
      guardrails: null,
    };
    const state1 = deriveRunGraphState(input1);
    const state2 = deriveRunGraphState(input2);
    expect(state1.nodes["step-1"]?.status).toBe("running");
    expect(state2.nodes["step-1"]?.status).toBe("succeeded");
  });
});
