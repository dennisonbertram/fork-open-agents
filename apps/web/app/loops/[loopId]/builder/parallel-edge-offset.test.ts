/**
 * parallel-edge-offset.test.ts — BT-LOOPS-050 through BT-LOOPS-053
 *
 * Behavioral tests for parallel-edge grouping and offset data in definitionToFlow.
 *
 * BT-LOOPS-050: When two edges connect the same (source, target) pair, both edges
 *   get parallelIndex and parallelCount > 1 in their data.
 * BT-LOOPS-051: When a single edge connects a (source, target) pair, the edge gets
 *   parallelIndex=0, parallelCount=1 in its data (no offset — builder unchanged).
 * BT-LOOPS-052: parallelIndex values within a group are unique and sequential from 0.
 * BT-LOOPS-053: Reversed pairs (A→B and B→A) are treated as independent groups
 *   (different direction = different visual channel; only same-direction parallel
 *   edges need offset).
 */

import { describe, expect, test } from "bun:test";
import { definitionToFlow } from "./definition-mapping";
import type { LoopDefinition } from "@/lib/agent-loops/types";

// ── BT-LOOPS-050: Parallel edges get parallelCount > 1 ───────────────────────

describe("BT-LOOPS-050: parallel edges (same source+target) get parallelCount > 1", () => {
  test("two edges with same source+target both get parallelCount=2", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", when: "true" },
        { id: "e2", source: "a", target: "b", when: "false" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const e1 = edges.find((e) => e.id === "e1");
    const e2 = edges.find((e) => e.id === "e2");

    expect(e1?.data?.parallelCount).toBe(2);
    expect(e2?.data?.parallelCount).toBe(2);
  });

  test("three parallel edges get parallelCount=3", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", when: "always" },
        { id: "e2", source: "a", target: "b", when: "success" },
        { id: "e3", source: "a", target: "b", when: "failure" },
      ],
    };

    const { edges } = definitionToFlow(def);
    for (const e of edges) {
      expect(e.data?.parallelCount).toBe(3);
    }
  });
});

// ── BT-LOOPS-051: Single edge gets parallelCount=1 ───────────────────────────

describe("BT-LOOPS-051: single edge gets parallelCount=1 (builder behavior unchanged)", () => {
  test("edge without a parallel sibling gets parallelIndex=0 and parallelCount=1", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b", when: "always" }],
    };

    const { edges } = definitionToFlow(def);
    const e1 = edges.find((e) => e.id === "e1");

    expect(e1?.data?.parallelIndex).toBe(0);
    expect(e1?.data?.parallelCount).toBe(1);
  });
});

// ── BT-LOOPS-052: parallelIndex values are unique and sequential ──────────────

describe("BT-LOOPS-052: parallelIndex values within a group are unique and sequential from 0", () => {
  test("two parallel edges get distinct parallelIndex values 0 and 1", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", when: "true" },
        { id: "e2", source: "a", target: "b", when: "false" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const indices = edges.map((e) => e.data?.parallelIndex).sort();
    expect(indices).toEqual([0, 1]);
  });

  test("three parallel edges get distinct parallelIndex values 0, 1, 2", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "end", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", when: "always" },
        { id: "e2", source: "a", target: "b", when: "success" },
        { id: "e3", source: "a", target: "b", when: "failure" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const indices = edges.map((e) => e.data?.parallelIndex).sort();
    expect(indices).toEqual([0, 1, 2]);
  });

  test("parallelIndex is unique across a mixed graph (some parallel, some not)", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "start", kind: "start", label: "S", position: { x: 0, y: 0 } },
        {
          id: "cond",
          kind: "condition",
          label: "C",
          position: { x: 200, y: 0 },
        },
        { id: "end", kind: "end", label: "E", position: { x: 400, y: 0 } },
      ],
      edges: [
        // Single edge: start→cond
        { id: "e-sc", source: "start", target: "cond", when: "always" },
        // Two parallel edges: cond→end (true + false — both go to end in this contrived example)
        { id: "e-ce-true", source: "cond", target: "end", when: "true" },
        { id: "e-ce-false", source: "cond", target: "end", when: "false" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const eSc = edges.find((e) => e.id === "e-sc");
    const eCeTrue = edges.find((e) => e.id === "e-ce-true");
    const eCeFalse = edges.find((e) => e.id === "e-ce-false");

    // Single edge: no offset
    expect(eSc?.data?.parallelCount).toBe(1);
    expect(eSc?.data?.parallelIndex).toBe(0);

    // Parallel pair: count=2, distinct indices
    expect(eCeTrue?.data?.parallelCount).toBe(2);
    expect(eCeFalse?.data?.parallelCount).toBe(2);
    const parallelIndices = [
      eCeTrue?.data?.parallelIndex,
      eCeFalse?.data?.parallelIndex,
    ].sort();
    expect(parallelIndices).toEqual([0, 1]);
  });
});

// ── BT-LOOPS-053: Reversed pairs are independent groups ──────────────────────

describe("BT-LOOPS-053: reversed pairs (A→B and B→A) are independent groups", () => {
  test("A→B forward edge and B→A reverse edge each get parallelCount=1", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "agent_step", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e-forward", source: "a", target: "b", when: "always" },
        { id: "e-reverse", source: "b", target: "a", when: "failure" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const eForward = edges.find((e) => e.id === "e-forward");
    const eReverse = edges.find((e) => e.id === "e-reverse");

    // Each is a separate group of 1 — not grouped together
    expect(eForward?.data?.parallelCount).toBe(1);
    expect(eReverse?.data?.parallelCount).toBe(1);
  });

  test("two forward A→B edges are grouped, but a B→A edge is not included in that group", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "a", kind: "start", label: "A", position: { x: 0, y: 0 } },
        { id: "b", kind: "agent_step", label: "B", position: { x: 200, y: 0 } },
      ],
      edges: [
        // Two parallel forward edges
        { id: "e-f1", source: "a", target: "b", when: "true" },
        { id: "e-f2", source: "a", target: "b", when: "false" },
        // One reverse edge — independent group
        { id: "e-rev", source: "b", target: "a", when: "failure" },
      ],
    };

    const { edges } = definitionToFlow(def);
    const eF1 = edges.find((e) => e.id === "e-f1");
    const eF2 = edges.find((e) => e.id === "e-f2");
    const eRev = edges.find((e) => e.id === "e-rev");

    // Forward parallel group: count=2
    expect(eF1?.data?.parallelCount).toBe(2);
    expect(eF2?.data?.parallelCount).toBe(2);

    // Reverse: independent single group
    expect(eRev?.data?.parallelCount).toBe(1);
    expect(eRev?.data?.parallelIndex).toBe(0);
  });
});
