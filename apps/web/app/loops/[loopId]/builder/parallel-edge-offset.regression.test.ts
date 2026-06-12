/**
 * parallel-edge-offset.regression.test.ts — TASK-366 regression harness
 *
 * These tests catch scenarios that would break if:
 *   - The parallel grouping logic in definitionToFlow is removed
 *   - The parallelCount/parallelIndex fields are dropped from LoopFlowEdgeData
 *   - Definition serialization round-trip (flowToDefinition) is broken by the new fields
 *   - Single edges regress to having offsets (they must have parallelIndex=0, parallelCount=1)
 *
 * Regression scenarios:
 *   R1. flowToDefinition still produces correct LoopDefinition when parallelIndex/Count present
 *   R2. Single edges are never given a parallelCount != 1 (builder unchanged for singletons)
 *   R3. Parallel group assignment is stable when definition is converted twice in a row
 *   R4. Definition with no edges produces empty edges array without crashing
 */

import { describe, expect, it } from "bun:test";
import { definitionToFlow, flowToDefinition } from "./definition-mapping";
import type { LoopDefinition } from "@/lib/agent-loops/types";

const PARALLEL_DEF: LoopDefinition = {
  nodes: [
    { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
    { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: "e-true", source: "a", target: "b", when: "true" },
    { id: "e-false", source: "a", target: "b", when: "false" },
  ],
};

// ── R1: flowToDefinition round-trip with parallelIndex/Count present ──────────

describe("regression R1: flowToDefinition round-trip is not broken by parallelIndex/Count fields", () => {
  it("regression: converting to flow and back produces structurally equal definition", () => {
    // If parallelIndex/parallelCount break the flowToDefinition mapping, this fails.
    const { nodes, edges } = definitionToFlow(PARALLEL_DEF);
    const roundTripped = flowToDefinition(nodes, edges);

    // Core structure must be preserved — not the add-only data fields
    expect(roundTripped.edges).toHaveLength(2);
    const eTrue = roundTripped.edges.find((e) => e.id === "e-true");
    const eFalse = roundTripped.edges.find((e) => e.id === "e-false");

    expect(eTrue?.source).toBe("a");
    expect(eTrue?.target).toBe("b");
    expect(eTrue?.when).toBe("true");
    expect(eFalse?.when).toBe("false");
  });
});

// ── R2: Single edges always have parallelCount=1 ─────────────────────────────

describe("regression R2: single edges have parallelCount=1 (no spurious offset)", () => {
  it("regression: if grouping logic is over-eager, singletons would get parallelCount > 1", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "m", kind: "agent_step", label: "M", position: { x: 200, y: 0 } },
        { id: "e", kind: "end", label: "E", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "s", target: "m", when: "always" },
        { id: "e2", source: "m", target: "e", when: "success" },
      ],
    };

    const { edges } = definitionToFlow(def);
    for (const edge of edges) {
      expect(edge.data?.parallelCount).toBe(1);
      expect(edge.data?.parallelIndex).toBe(0);
    }
  });
});

// ── R3: Stable assignment across repeated conversions ─────────────────────────

describe("regression R3: parallelIndex assignment is stable when called twice on same definition", () => {
  it("regression: calling definitionToFlow twice produces identical parallelIndex values", () => {
    const { edges: edges1 } = definitionToFlow(PARALLEL_DEF);
    const { edges: edges2 } = definitionToFlow(PARALLEL_DEF);

    for (let i = 0; i < edges1.length; i++) {
      expect(edges1[i]?.data?.parallelIndex).toBe(
        edges2[i]?.data?.parallelIndex,
      );
      expect(edges1[i]?.data?.parallelCount).toBe(
        edges2[i]?.data?.parallelCount,
      );
    }
  });
});

// ── R4: Empty edges definition doesn't crash ─────────────────────────────────

describe("regression R4: definition with no edges does not crash definitionToFlow", () => {
  it("regression: empty edges array produces empty flow edges without error", () => {
    const def: LoopDefinition = {
      nodes: [{ id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } }],
      edges: [],
    };

    expect(() => definitionToFlow(def)).not.toThrow();
    const { edges } = definitionToFlow(def);
    expect(edges).toHaveLength(0);
  });
});
