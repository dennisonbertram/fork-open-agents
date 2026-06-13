/**
 * Tests for definition-mapping.ts — RED commit
 * BT-001: definitionToFlow + flowToDefinition round-trip is lossless
 * BT-002: canonical key order — unchanged load→save is deep-equal
 * BT-003: unknown/extra config fields preserved untouched
 * BT-004: positions are preserved through round-trip
 */

import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { definitionToFlow, flowToDefinition } from "./definition-mapping";

// ── Fixture definitions ────────────────────────────────────────────────────────

const SIMPLE_DEF: LoopDefinition = {
  nodes: [
    {
      id: "start-1",
      kind: "start",
      label: "Start",
      position: { x: 100, y: 200 },
    },
    {
      id: "step-1",
      kind: "agent_step",
      label: "My Step",
      position: { x: 300, y: 200 },
      instructions: "Do something useful",
    },
    { id: "end-1", kind: "end", label: "End", position: { x: 500, y: 200 } },
  ],
  edges: [
    { id: "e-1", source: "start-1", target: "step-1", when: "always" },
    { id: "e-2", source: "step-1", target: "end-1", when: "success" },
  ],
};

const CONDITION_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "cond-1",
      kind: "condition",
      label: "Check Status",
      position: { x: 200, y: 0 },
      condition: { path: "status", op: "eq", value: "open" },
    },
    {
      id: "end-success",
      kind: "end",
      label: "Done",
      position: { x: 400, y: -100 },
    },
    {
      id: "end-fail",
      kind: "end",
      label: "Fail",
      position: { x: 400, y: 100 },
    },
  ],
  edges: [
    { id: "e-1", source: "start-1", target: "cond-1", when: "always" },
    { id: "e-2", source: "cond-1", target: "end-success", when: "true" },
    { id: "e-3", source: "cond-1", target: "end-fail", when: "false" },
  ],
};

const GITHUB_CHECK_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "gh-1",
      kind: "github_check",
      label: "Check PR",
      position: { x: 200, y: 0 },
      check: { kind: "pr_status", prNumberFrom: "context.prNumber" },
    },
    { id: "end-1", kind: "end", label: "End", position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: "e-1", source: "start-1", target: "gh-1", when: "always" },
    { id: "e-2", source: "gh-1", target: "end-1", when: "success" },
  ],
};

// ── BT-001: Round-trip losslessness ───────────────────────────────────────────

describe("definitionToFlow + flowToDefinition round-trip", () => {
  it("BT-001: simple definition round-trips to deep-equal output", () => {
    const { nodes, edges } = definitionToFlow(SIMPLE_DEF);
    const result = flowToDefinition(nodes, edges);
    expect(result).toEqual(SIMPLE_DEF);
  });

  it("BT-001: condition definition round-trips to deep-equal output", () => {
    const { nodes, edges } = definitionToFlow(CONDITION_DEF);
    const result = flowToDefinition(nodes, edges);
    expect(result).toEqual(CONDITION_DEF);
  });

  it("BT-001: github_check definition round-trips to deep-equal output", () => {
    const { nodes, edges } = definitionToFlow(GITHUB_CHECK_DEF);
    const result = flowToDefinition(nodes, edges);
    expect(result).toEqual(GITHUB_CHECK_DEF);
  });

  it("BT-001: empty definition (no nodes/edges) round-trips", () => {
    const emptyDef: LoopDefinition = { nodes: [], edges: [] };
    const { nodes, edges } = definitionToFlow(emptyDef);
    const result = flowToDefinition(nodes, edges);
    expect(result).toEqual(emptyDef);
  });
});

// ── BT-002: Canonical key order / stability ───────────────────────────────────

describe("canonical serialization stability", () => {
  it("BT-002: serializing unchanged flow produces identical JSON to original definition", () => {
    const { nodes, edges } = definitionToFlow(SIMPLE_DEF);
    const result = flowToDefinition(nodes, edges);
    // JSON serialization must be identical (stable key order)
    expect(JSON.stringify(result)).toBe(JSON.stringify(SIMPLE_DEF));
  });

  it("BT-002: condition definition serialization is stable", () => {
    const { nodes, edges } = definitionToFlow(CONDITION_DEF);
    const result = flowToDefinition(nodes, edges);
    expect(JSON.stringify(result)).toBe(JSON.stringify(CONDITION_DEF));
  });
});

// ── BT-003: Extra/opaque config fields preserved ──────────────────────────────

describe("opaque config field preservation", () => {
  it("BT-003: agent_step instructions pass through untouched", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "S",
          position: { x: 0, y: 0 },
        },
        {
          id: "a",
          kind: "agent_step",
          label: "Agent",
          position: { x: 100, y: 0 },
          instructions: "Complex instructions with lots of text here",
          checkCommand: "bun test",
        },
        { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "s", target: "a", when: "always" },
        { id: "e2", source: "a", target: "e", when: "success" },
      ],
    };
    const { nodes, edges } = definitionToFlow(def);
    const result = flowToDefinition(nodes, edges);
    const agentNode = result.nodes.find((n) => n.id === "a");
    expect(agentNode).toBeDefined();
    if (agentNode?.kind === "agent_step") {
      expect(agentNode.instructions).toBe(
        "Complex instructions with lots of text here",
      );
      expect(agentNode.checkCommand).toBe("bun test");
    }
  });

  it("BT-003: condition config with value field passes through untouched", () => {
    const { nodes, edges } = definitionToFlow(CONDITION_DEF);
    const result = flowToDefinition(nodes, edges);
    const condNode = result.nodes.find((n) => n.id === "cond-1");
    expect(condNode).toBeDefined();
    if (condNode?.kind === "condition") {
      expect(condNode.condition).toEqual({
        path: "status",
        op: "eq",
        value: "open",
      });
    }
  });
});

// ── BT-004: Position preservation ────────────────────────────────────────────

describe("position preservation", () => {
  it("BT-004: node positions are preserved through round-trip", () => {
    const { nodes, edges } = definitionToFlow(SIMPLE_DEF);
    const result = flowToDefinition(nodes, edges);
    for (const originalNode of SIMPLE_DEF.nodes) {
      const roundTrippedNode = result.nodes.find(
        (n) => n.id === originalNode.id,
      );
      expect(roundTrippedNode?.position).toEqual(originalNode.position);
    }
  });

  it("BT-004: updated positions in flow nodes are reflected in definition", () => {
    const { nodes, edges } = definitionToFlow(SIMPLE_DEF);
    // Simulate a drag — update the position of a flow node
    const updatedNodes = nodes.map((n) =>
      n.id === "step-1" ? { ...n, position: { x: 999, y: 888 } } : n,
    );
    const result = flowToDefinition(updatedNodes, edges);
    const movedNode = result.nodes.find((n) => n.id === "step-1");
    expect(movedNode?.position).toEqual({ x: 999, y: 888 });
  });
});

// ── definitionToFlow structure tests ─────────────────────────────────────────

describe("definitionToFlow output structure", () => {
  it("produces one React Flow node per LoopNode", () => {
    const { nodes } = definitionToFlow(SIMPLE_DEF);
    expect(nodes).toHaveLength(SIMPLE_DEF.nodes.length);
  });

  it("produces one React Flow edge per LoopEdge", () => {
    const { edges } = definitionToFlow(SIMPLE_DEF);
    expect(edges).toHaveLength(SIMPLE_DEF.edges.length);
  });

  it("React Flow nodes have id matching LoopNode id", () => {
    const { nodes } = definitionToFlow(SIMPLE_DEF);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("start-1");
    expect(ids).toContain("step-1");
    expect(ids).toContain("end-1");
  });

  it("React Flow edges carry the when value in data", () => {
    const { edges } = definitionToFlow(SIMPLE_DEF);
    const e1 = edges.find((e) => e.id === "e-1");
    expect(e1?.data?.when).toBe("always");
    const e2 = edges.find((e) => e.id === "e-2");
    expect(e2?.data?.when).toBe("success");
  });

  it("React Flow node position matches LoopNode position", () => {
    const { nodes } = definitionToFlow(SIMPLE_DEF);
    const startNode = nodes.find((n) => n.id === "start-1");
    expect(startNode?.position).toEqual({ x: 100, y: 200 });
  });

  it("React Flow node data carries kind and label", () => {
    const { nodes } = definitionToFlow(SIMPLE_DEF);
    const startNode = nodes.find((n) => n.id === "start-1");
    expect(startNode?.data?.kind).toBe("start");
    expect(startNode?.data?.label).toBe("Start");
  });
});

// ── Loop-back detection (BT-LOOPBACK) ──────────────────────────────────────────

describe("loop-back edge detection", () => {
  const CYCLE_DEF: LoopDefinition = {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "review",
        kind: "agent_step",
        label: "Review",
        position: { x: 200, y: 0 },
      },
      {
        id: "gate",
        kind: "condition",
        label: "Passed?",
        position: { x: 400, y: 0 },
        condition: { path: "review.passed", op: "eq", value: true },
      },
      {
        id: "fix",
        kind: "agent_step",
        label: "Fix",
        position: { x: 300, y: 160 },
      },
      { id: "end", kind: "end", label: "Done", position: { x: 600, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "review", when: "always" },
      { id: "e2", source: "review", target: "gate", when: "success" },
      { id: "e3", source: "gate", target: "end", when: "true" },
      { id: "e4", source: "gate", target: "fix", when: "false" },
      { id: "e5", source: "fix", target: "review", when: "success" }, // loop-back
    ],
  };

  it("BT-LOOPBACK-001: marks the cycle-closing edge as isLoopBack", () => {
    const { edges } = definitionToFlow(CYCLE_DEF);
    const byId = new Map(edges.map((e) => [e.id, e]));
    // fix → review points back to an earlier depth: loop-back
    expect(byId.get("e5")?.data?.isLoopBack).toBe(true);
  });

  it("BT-LOOPBACK-002: forward edges are NOT marked as loop-backs", () => {
    const { edges } = definitionToFlow(CYCLE_DEF);
    const byId = new Map(edges.map((e) => [e.id, e]));
    for (const id of ["e1", "e2", "e3", "e4"]) {
      expect(byId.get(id)?.data?.isLoopBack).toBe(false);
    }
  });

  it("BT-LOOPBACK-003: a purely linear graph has no loop-backs", () => {
    const { edges } = definitionToFlow(SIMPLE_DEF);
    for (const edge of edges) {
      expect(edge.data?.isLoopBack).toBe(false);
    }
  });
});
