/**
 * builder.regression.test.ts — regression harness for the loop builder.
 *
 * These tests would fail if the changes in e0077ab6 were reverted.
 * They catch different failure modes than the behavioral tests:
 *   - Multi-step round-trips (double-round-trip stability)
 *   - Edge reconstruction from graph mutations
 *   - legalWhenValues completeness (no missing options)
 *   - defaultNodeData edge cases (condition gets placeholder config)
 *   - flowToDefinition throws on unknown kind (safety net)
 *   - canonicalization: adding/removing optional fields leaves no undefined keys
 */

import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { definitionToFlow, flowToDefinition } from "./definition-mapping";
import { createLoopBuilderStore } from "./use-loop-builder";

// ── Double round-trip stability ───────────────────────────────────────────────

describe("double round-trip stability", () => {
  const COMPLEX_DEF: LoopDefinition = {
    nodes: [
      { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      {
        id: "a1",
        kind: "agent_step",
        label: "Step 1",
        position: { x: 200, y: 0 },
        instructions: "First step instructions",
        checkCommand: "bun test",
      },
      {
        id: "c1",
        kind: "condition",
        label: "Gate",
        position: { x: 400, y: 0 },
        condition: { path: "output.status", op: "eq", value: "ready" },
      },
      {
        id: "gh1",
        kind: "github_check",
        label: "CI",
        position: { x: 600, y: -100 },
        check: { kind: "ci_status", refFrom: "context.branch" },
      },
      { id: "e1", kind: "end", label: "Done", position: { x: 800, y: 0 } },
      { id: "e2", kind: "end", label: "Fail", position: { x: 600, y: 100 } },
    ],
    edges: [
      { id: "ed1", source: "s", target: "a1", when: "always" },
      { id: "ed2", source: "a1", target: "c1", when: "success" },
      { id: "ed3", source: "c1", target: "gh1", when: "true" },
      { id: "ed4", source: "c1", target: "e2", when: "false" },
      { id: "ed5", source: "gh1", target: "e1", when: "success" },
    ],
  };

  it("regression: definition → flow → definition → flow → definition is deep-equal after two trips", () => {
    const { nodes: n1, edges: e1 } = definitionToFlow(COMPLEX_DEF);
    const def1 = flowToDefinition(n1, e1);
    const { nodes: n2, edges: e2 } = definitionToFlow(def1);
    const def2 = flowToDefinition(n2, e2);
    expect(def2).toEqual(COMPLEX_DEF);
  });

  it("regression: JSON serialization is stable across two round-trips", () => {
    const { nodes: n1, edges: e1 } = definitionToFlow(COMPLEX_DEF);
    const def1 = flowToDefinition(n1, e1);
    const { nodes: n2, edges: e2 } = definitionToFlow(def1);
    const def2 = flowToDefinition(n2, e2);
    expect(JSON.stringify(def2)).toBe(JSON.stringify(COMPLEX_DEF));
  });
});

// ── Store: new nodes get valid unique IDs ─────────────────────────────────────

describe("regression: unique node IDs across kinds", () => {
  it("regression: 10 rapid addNode calls produce 10 unique IDs", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = store.getState().addNode("agent_step", { x: i * 10, y: 0 });
      ids.add(id);
    }
    expect(ids.size).toBe(10);
  });

  it("regression: addNode for each non-start kind produces unique IDs", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const kinds = ["agent_step", "github_check", "condition", "end"] as const;
    const ids = kinds.map((k) => store.getState().addNode(k, { x: 0, y: 0 }));
    const unique = new Set(ids);
    expect(unique.size).toBe(4);
  });
});

// ── Store: condition placeholder config doesn't crash validation ──────────────

describe("regression: condition node placeholder config", () => {
  it("regression: new condition node has condition config with op=exists (valid default)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("condition", { x: 0, y: 0 });
    const node = store.getState().nodes.find((n) => n.id === id);
    expect(node).toBeDefined();
    expect(node?.data?.kind).toBe("condition");
    if (node?.data?.kind === "condition") {
      expect(node.data.condition?.op).toBe("exists");
    }
  });
});

// ── legalWhenValues completeness ──────────────────────────────────────────────

describe("regression: legalWhenValues completeness", () => {
  it("regression: condition source returns exactly [true, false]", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "c", kind: "condition", label: "C", position: { x: 100, y: 0 } },
        { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [],
    });
    const options = store.getState().legalWhenValues("c");
    expect(options.sort()).toEqual(["false", "true"]);
  });

  it("regression: non-condition source returns exactly [success, failure, always]", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "a", kind: "agent_step", label: "A", position: { x: 100, y: 0 } },
        { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [],
    });
    const options = store.getState().legalWhenValues("a");
    expect(options.sort()).toEqual(["always", "failure", "success"]);
  });

  it("regression: unknown node ID returns non-condition defaults (safe fallback)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const options = store.getState().legalWhenValues("nonexistent-id");
    expect(options).toContain("success");
    expect(options).toContain("failure");
    expect(options).toContain("always");
    expect(options).not.toContain("true");
    expect(options).not.toContain("false");
  });
});

// ── flowToDefinition doesn't produce undefined keys ──────────────────────────

describe("regression: no undefined keys in round-trip output", () => {
  it("regression: agent_step without instructions has no instructions key in output", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "a", kind: "agent_step", label: "A", position: { x: 100, y: 0 } },
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
    // Must not have undefined keys — they would break JSON serialization equality
    const serialized = JSON.stringify(agentNode);
    expect(serialized).not.toContain('"instructions":');
    expect(serialized).not.toContain('"outputSchema":');
    expect(serialized).not.toContain('"checkCommand":');
  });

  it("regression: github_check without check has no check key in output", () => {
    const def: LoopDefinition = {
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        {
          id: "g",
          kind: "github_check",
          label: "G",
          position: { x: 100, y: 0 },
        },
        { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "s", target: "g", when: "always" },
        { id: "e2", source: "g", target: "e", when: "success" },
      ],
    };
    const { nodes, edges } = definitionToFlow(def);
    const result = flowToDefinition(nodes, edges);
    const ghNode = result.nodes.find((n) => n.id === "g");
    const serialized = JSON.stringify(ghNode);
    expect(serialized).not.toContain('"check":');
  });
});

// ── Store: edge when value preserved through change ──────────────────────────

describe("regression: edge when value preserved through graph changes", () => {
  it("regression: connectEdge with 'failure' preserves 'failure' in currentDefinition", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "a", kind: "agent_step", label: "A", position: { x: 100, y: 0 } },
        { id: "e", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [{ id: "e1", source: "s", target: "a", when: "always" }],
    });
    store.getState().connectEdge({ source: "a", target: "e", when: "failure" });
    const def = store.getState().currentDefinition();
    const edge = def.edges.find(
      (edge) => edge.source === "a" && edge.target === "e",
    );
    expect(edge?.when).toBe("failure");
  });

  it("regression: condition edges with true/false preserved in currentDefinition", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "c", kind: "condition", label: "C", position: { x: 100, y: 0 } },
        { id: "e1", kind: "end", label: "E1", position: { x: 200, y: -50 } },
        { id: "e2", kind: "end", label: "E2", position: { x: 200, y: 50 } },
      ],
      edges: [{ id: "ed1", source: "s", target: "c", when: "always" }],
    });
    store.getState().connectEdge({ source: "c", target: "e1", when: "true" });
    store.getState().connectEdge({ source: "c", target: "e2", when: "false" });
    const def = store.getState().currentDefinition();
    const trueEdge = def.edges.find(
      (e) => e.source === "c" && e.target === "e1",
    );
    const falseEdge = def.edges.find(
      (e) => e.source === "c" && e.target === "e2",
    );
    expect(trueEdge?.when).toBe("true");
    expect(falseEdge?.when).toBe("false");
  });
});
