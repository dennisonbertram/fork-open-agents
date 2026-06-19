/**
 * run-graph-merge.test.ts — No-remount contract test for stable node/edge identity
 *
 * BT-LOOPS-051: Poll update changes overlays without remount (stable node identity).
 *
 * This test is pinned at the data-contract level: React Flow re-mounts a node
 * iff its `id` changes. By testing applyNodeRunState / applyEdgeRunState in
 * isolation we ensure that successive poll updates never drop, add, or re-key
 * any node or edge — i.e. the identity contract holds and no canvas remount
 * occurs on poll.
 *
 * For context on the two-memo-layer separation that makes this safe, see the
 * comments in run-graph.tsx (baseNodes/baseEdges memoized on immutable
 * definitionSnapshot vs nodes/edges memoized on graphState).
 *
 * Assertions:
 *   (a) Output arrays preserve length, order, and ids 1:1 with baseNodes/baseEdges
 *       — no node/edge is ever dropped, added, or re-keyed by a poll.
 *   (b) A status change affecting only node B leaves node A's output deep-equal
 *       to its previous output (unchanged nodes are stable).
 *   (c) Identical graphState input twice → deep-equal outputs (idempotent).
 *   (d) Same three properties for applyEdgeRunState (edge ids stable across
 *       traversal-state changes).
 */

import { describe, expect, test } from "bun:test";
import { applyNodeRunState, applyEdgeRunState } from "./run-graph-merge";
import type {
  LoopFlowNode,
  LoopFlowEdge,
} from "@/app/loops/[loopId]/builder/definition-mapping";
import type { RunGraphState } from "./use-run-graph-state";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBaseNodes(): LoopFlowNode[] {
  return [
    {
      id: "node-a",
      type: "loopNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "start",
        id: "node-a",
        label: "Start",
      } as LoopFlowNode["data"],
    },
    {
      id: "node-b",
      type: "loopNode",
      position: { x: 200, y: 0 },
      data: {
        kind: "agent_step",
        id: "node-b",
        label: "Step",
      } as LoopFlowNode["data"],
    },
    {
      id: "node-c",
      type: "loopNode",
      position: { x: 400, y: 0 },
      data: { kind: "end", id: "node-c", label: "End" } as LoopFlowNode["data"],
    },
  ];
}

function makeBaseEdges(): LoopFlowEdge[] {
  return [
    {
      id: "edge-ab",
      source: "node-a",
      target: "node-b",
      type: "when",
      data: { when: "always" as const },
    },
    {
      id: "edge-bc",
      source: "node-b",
      target: "node-c",
      type: "when",
      data: { when: "success" as const },
    },
  ];
}

function makeGraphState(
  overrides: Partial<RunGraphState["nodes"]> = {},
): RunGraphState {
  return {
    currentNodeId: null,
    nodes: {
      "node-a": { status: "unvisited", visitCount: 0, latestAttempt: 0 },
      "node-b": { status: "unvisited", visitCount: 0, latestAttempt: 0 },
      "node-c": { status: "unvisited", visitCount: 0, latestAttempt: 0 },
      ...overrides,
    },
    edges: {
      "edge-ab": { traversed: false, mostRecent: false },
      "edge-bc": { traversed: false, mostRecent: false },
    },
    meter: {
      iterationCount: 1,
      maxIterations: 10,
      stepCount: 0,
      maxStepsPerRun: 50,
    },
  };
}

// ── applyNodeRunState tests ────────────────────────────────────────────────────

describe("BT-LOOPS-051a: applyNodeRunState — stable identity across polls", () => {
  test("output length equals baseNodes length", () => {
    const base = makeBaseNodes();
    const result = applyNodeRunState(base, makeGraphState());
    expect(result).toHaveLength(base.length);
  });

  test("output ids match baseNodes ids in order", () => {
    const base = makeBaseNodes();
    const result = applyNodeRunState(base, makeGraphState());
    expect(result.map((n) => n.id)).toEqual(base.map((n) => n.id));
  });

  test("no node is dropped, added, or re-keyed on a status-change poll", () => {
    const base = makeBaseNodes();
    const state1 = makeGraphState();
    const state2 = makeGraphState({
      "node-b": { status: "running", visitCount: 1, latestAttempt: 1 },
    });

    const result1 = applyNodeRunState(base, state1);
    const result2 = applyNodeRunState(base, state2);

    // Same number of nodes
    expect(result2).toHaveLength(result1.length);
    // Same ids in same order
    expect(result2.map((n) => n.id)).toEqual(result1.map((n) => n.id));
  });
});

describe("BT-LOOPS-051b: applyNodeRunState — unaffected nodes remain stable", () => {
  test("changing node-b status leaves node-a data unchanged", () => {
    const base = makeBaseNodes();

    const state1 = makeGraphState();
    const state2 = makeGraphState({
      "node-b": { status: "running", visitCount: 1, latestAttempt: 1 },
    });

    const result1 = applyNodeRunState(base, state1);
    const result2 = applyNodeRunState(base, state2);

    const nodeABefore = result1.find((n) => n.id === "node-a")!;
    const nodeAAfter = result2.find((n) => n.id === "node-a")!;

    expect(nodeAAfter.data).toEqual(nodeABefore.data);
  });
});

describe("BT-LOOPS-051c: applyNodeRunState — idempotent on same input", () => {
  test("identical graphState input twice produces deep-equal outputs", () => {
    const base = makeBaseNodes();
    const state = makeGraphState({
      "node-a": { status: "succeeded", visitCount: 1, latestAttempt: 1 },
    });

    const result1 = applyNodeRunState(base, state);
    const result2 = applyNodeRunState(base, state);

    expect(result1).toEqual(result2);
  });
});

// ── applyEdgeRunState tests ───────────────────────────────────────────────────

describe("BT-LOOPS-051d: applyEdgeRunState — stable identity across polls", () => {
  test("output length equals baseEdges length", () => {
    const base = makeBaseEdges();
    const result = applyEdgeRunState(base, makeGraphState());
    expect(result).toHaveLength(base.length);
  });

  test("output ids match baseEdges ids in order", () => {
    const base = makeBaseEdges();
    const result = applyEdgeRunState(base, makeGraphState());
    expect(result.map((e) => e.id)).toEqual(base.map((e) => e.id));
  });

  test("traversal state change does not drop or re-key any edge", () => {
    const base = makeBaseEdges();
    const state1 = makeGraphState();
    const state2: RunGraphState = {
      ...makeGraphState(),
      edges: {
        "edge-ab": { traversed: true, mostRecent: true },
        "edge-bc": { traversed: false, mostRecent: false },
      },
    };

    const result1 = applyEdgeRunState(base, state1);
    const result2 = applyEdgeRunState(base, state2);

    expect(result2).toHaveLength(result1.length);
    expect(result2.map((e) => e.id)).toEqual(result1.map((e) => e.id));
  });

  test("identical graphState input twice produces deep-equal edge outputs", () => {
    const base = makeBaseEdges();
    const state: RunGraphState = {
      ...makeGraphState(),
      edges: {
        "edge-ab": { traversed: true, mostRecent: true },
        "edge-bc": { traversed: true, mostRecent: false },
      },
    };

    const result1 = applyEdgeRunState(base, state);
    const result2 = applyEdgeRunState(base, state);

    expect(result1).toEqual(result2);
  });
});

// ── run-state data correctness ─────────────────────────────────────────────────

describe("run-state merging correctness", () => {
  test("applyNodeRunState injects runStatus, visitCount, isCurrent", () => {
    const base = makeBaseNodes();
    const state: RunGraphState = {
      ...makeGraphState({
        "node-b": { status: "running", visitCount: 2, latestAttempt: 2 },
      }),
      currentNodeId: "node-b",
    };

    const result = applyNodeRunState(base, state);
    const nodeB = result.find((n) => n.id === "node-b")!;

    expect(nodeB.data.runStatus).toBe("running");
    expect(nodeB.data.visitCount).toBe(2);
    expect(nodeB.data.isCurrent).toBe(true);
  });

  test("applyNodeRunState sets isCurrent=false for non-current nodes", () => {
    const base = makeBaseNodes();
    const state: RunGraphState = {
      ...makeGraphState({
        "node-b": { status: "running", visitCount: 1, latestAttempt: 1 },
      }),
      currentNodeId: "node-b",
    };

    const result = applyNodeRunState(base, state);
    const nodeA = result.find((n) => n.id === "node-a")!;

    expect(nodeA.data.isCurrent).toBe(false);
  });

  test("applyEdgeRunState injects traversed and mostRecent", () => {
    const base = makeBaseEdges();
    const state: RunGraphState = {
      ...makeGraphState(),
      edges: {
        "edge-ab": { traversed: true, mostRecent: true },
        "edge-bc": { traversed: false, mostRecent: false },
      },
    };

    const result = applyEdgeRunState(base, state);
    const edgeAB = result.find((e) => e.id === "edge-ab")!;
    const edgeBC = result.find((e) => e.id === "edge-bc")!;

    expect(edgeAB.data?.traversed).toBe(true);
    expect(edgeAB.data?.mostRecent).toBe(true);
    expect(edgeBC.data?.traversed).toBe(false);
    expect(edgeBC.data?.mostRecent).toBe(false);
  });
});
