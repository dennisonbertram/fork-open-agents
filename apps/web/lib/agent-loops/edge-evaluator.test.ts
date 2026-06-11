/**
 * Agent Loops — edge evaluator unit tests (TDD RED)
 *
 * Full edge-routing matrix:
 *   EE-01  success outcome picks success edge
 *   EE-02  failure outcome picks failure edge
 *   EE-03  true outcome picks true edge
 *   EE-04  false outcome picks false edge
 *   EE-05  always edge is fallback when no matching outcome edge
 *   EE-06  no matching edge and no always → returns nulls
 *   EE-07  failed step with no failure or always edge → returns nulls
 *   EE-08  result nextNodeId is a declared node (property test)
 *   EE-09  multiple edges from same node — only the matching one is returned
 *   EE-10  nodeId not in definition → returns nulls
 */

import { describe, expect, test } from "bun:test";
import { evaluateEdges } from "./edge-evaluator";
import type { LoopDefinition } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDefinition(overrides?: Partial<LoopDefinition>): LoopDefinition {
  return {
    nodes: [
      { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "step-1",
        kind: "agent_step",
        label: "Step",
        position: { x: 100, y: 0 },
        instructions: "Do work",
      },
      { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start-1", target: "step-1", when: "always" },
      { id: "e2", source: "step-1", target: "end-1", when: "success" },
    ],
    ...overrides,
  };
}

// ── EE-01: success outcome picks success edge ─────────────────────────────────

describe("evaluateEdges — EE-01 success outcome", () => {
  test("returns the success-edge target when outcome is success", () => {
    const def = makeDefinition();
    const result = evaluateEdges(def, "step-1", "success");
    expect(result.nextNodeId).toBe("end-1");
    expect(result.edgeId).toBe("e2");
  });
});

// ── EE-02: failure outcome picks failure edge ─────────────────────────────────

describe("evaluateEdges — EE-02 failure outcome", () => {
  test("returns the failure-edge target when outcome is failure", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "retry-1", kind: "agent_step", label: "Retry", position: { x: 100, y: 100 } },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "end-1", when: "success" },
        { id: "e3", source: "step-1", target: "retry-1", when: "failure" },
        { id: "e4", source: "retry-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "step-1", "failure");
    expect(result.nextNodeId).toBe("retry-1");
    expect(result.edgeId).toBe("e3");
  });
});

// ── EE-03: true outcome picks true edge ──────────────────────────────────────

describe("evaluateEdges — EE-03 true outcome", () => {
  test("returns the true-edge target when outcome is true", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "cond-1",
          kind: "condition",
          label: "Cond",
          position: { x: 100, y: 0 },
          condition: { path: "check.count", op: "gt", value: 0 },
        },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 200, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "cond-1", when: "always" },
        { id: "e2", source: "cond-1", target: "step-1", when: "true" },
        { id: "e3", source: "cond-1", target: "end-1", when: "false" },
        { id: "e4", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "cond-1", "true");
    expect(result.nextNodeId).toBe("step-1");
    expect(result.edgeId).toBe("e2");
  });
});

// ── EE-04: false outcome picks false edge ────────────────────────────────────

describe("evaluateEdges — EE-04 false outcome", () => {
  test("returns the false-edge target when outcome is false", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "cond-1",
          kind: "condition",
          label: "Cond",
          position: { x: 100, y: 0 },
          condition: { path: "check.count", op: "gt", value: 0 },
        },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 200, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "cond-1", when: "always" },
        { id: "e2", source: "cond-1", target: "step-1", when: "true" },
        { id: "e3", source: "cond-1", target: "end-1", when: "false" },
        { id: "e4", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "cond-1", "false");
    expect(result.nextNodeId).toBe("end-1");
    expect(result.edgeId).toBe("e3");
  });
});

// ── EE-05: always edge fallback ───────────────────────────────────────────────

describe("evaluateEdges — EE-05 always fallback", () => {
  test("falls back to always edge when no direct match for outcome", () => {
    // start node: only has an always edge; outcome is success (no success edge)
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "end-1", when: "always" },
      ],
    };
    const result = evaluateEdges(def, "step-1", "success");
    expect(result.nextNodeId).toBe("end-1");
    expect(result.edgeId).toBe("e2");
  });
});

// ── EE-06: no matching edge and no always → nulls ────────────────────────────

describe("evaluateEdges — EE-06 no match → nulls", () => {
  test("returns null nextNodeId and null edgeId when outcome has no match and no always edge", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        // step-1 has only a success edge — failure has no match
        { id: "e2", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "step-1", "failure");
    expect(result.nextNodeId).toBeNull();
    expect(result.edgeId).toBeNull();
  });
});

// ── EE-07: failed step with no failure or always edge → nulls ────────────────

describe("evaluateEdges — EE-07 failed step no failure/always edge", () => {
  test("returns nulls when a step fails with no failure or always edge", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "step-1", "failure");
    expect(result.nextNodeId).toBeNull();
    expect(result.edgeId).toBeNull();
  });
});

// ── EE-08: property test — result is declared node or null ───────────────────

describe("evaluateEdges — EE-08 property: result is declared node or null", () => {
  test("nextNodeId is always a node in the definition or null (simple graph)", () => {
    const def = makeDefinition();
    const nodeIds = new Set(def.nodes.map((n) => n.id));
    const outcomes = ["success", "failure", "true", "false"] as const;
    for (const outcome of outcomes) {
      for (const node of def.nodes) {
        const result = evaluateEdges(def, node.id, outcome);
        if (result.nextNodeId !== null) {
          expect(nodeIds.has(result.nextNodeId)).toBe(true);
        }
      }
    }
  });

  test("nextNodeId is always a declared node or null for a cycle graph", () => {
    const cycleDef: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "step-1", when: "failure" },
        { id: "e3", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const nodeIds = new Set(cycleDef.nodes.map((n) => n.id));
    const outcomes = ["success", "failure"] as const;
    for (const outcome of outcomes) {
      const result = evaluateEdges(cycleDef, "step-1", outcome);
      if (result.nextNodeId !== null) {
        expect(nodeIds.has(result.nextNodeId)).toBe(true);
      }
    }
  });
});

// ── EE-09: multiple edges from same node — only matching one returned ─────────

describe("evaluateEdges — EE-09 multiple edges, only matching returned", () => {
  test("returns only the success edge when node has success and failure edges", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-success", kind: "end", label: "Success", position: { x: 200, y: 0 } },
        { id: "end-fail", kind: "end", label: "Fail", position: { x: 200, y: 100 } },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "end-success", when: "success" },
        { id: "e3", source: "step-1", target: "end-fail", when: "failure" },
      ],
    };
    const successResult = evaluateEdges(def, "step-1", "success");
    expect(successResult.nextNodeId).toBe("end-success");
    expect(successResult.edgeId).toBe("e2");

    const failureResult = evaluateEdges(def, "step-1", "failure");
    expect(failureResult.nextNodeId).toBe("end-fail");
    expect(failureResult.edgeId).toBe("e3");
  });
});

// ── EE-10: nodeId not in definition → nulls ───────────────────────────────────

describe("evaluateEdges — EE-10 unknown nodeId", () => {
  test("returns nulls when nodeId does not exist in the definition", () => {
    const def = makeDefinition();
    const result = evaluateEdges(def, "nonexistent-node", "success");
    expect(result.nextNodeId).toBeNull();
    expect(result.edgeId).toBeNull();
  });
});
