/**
 * Tests for use-loop-builder.ts — RED commit
 * BT-005: add-node defaults (unique ids, palette kinds)
 * BT-006: onConnect requires explicit when value (no edge until picked)
 * BT-007: validation errors update on graph change
 * BT-008: dirty tracking
 * BT-009: edge when-legality (condition → true/false; others → success/failure/always)
 */

import { describe, expect, it, beforeEach } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { createLoopBuilderStore } from "./use-loop-builder";

// Minimal valid definition (start + end + edge)
const VALID_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: "e-1", source: "start-1", target: "end-1", when: "always" },
  ],
};

describe("createLoopBuilderStore — initialization", () => {
  it("BT-008: initializing with a definition marks the store as not dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);
  });

  it("BT-007: initializing with a valid definition produces no validation errors", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().validationErrors).toHaveLength(0);
  });

  it("initializes with the correct number of nodes", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().nodes).toHaveLength(2);
  });

  it("initializes with the correct number of edges", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().edges).toHaveLength(1);
  });
});

describe("createLoopBuilderStore — addNode", () => {
  it("BT-005: addNode generates a unique id for each new node", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    store.getState().addNode("agent_step", { x: 200, y: 200 });
    const nodes = store.getState().nodes;
    const addedNodes = nodes.filter((n) => n.data?.kind === "agent_step");
    expect(addedNodes).toHaveLength(2);
    expect(addedNodes[0]!.id).not.toBe(addedNodes[1]!.id);
  });

  it("BT-005: addNode adds agent_step with kind=agent_step", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    const nodes = store.getState().nodes;
    const newNode = nodes.find((n) => n.data?.kind === "agent_step");
    expect(newNode).toBeDefined();
    expect(newNode?.data?.kind).toBe("agent_step");
  });

  it("BT-005: addNode adds condition with kind=condition", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("condition", { x: 100, y: 100 });
    const nodes = store.getState().nodes;
    const newNode = nodes.find((n) => n.data?.kind === "condition");
    expect(newNode).toBeDefined();
  });

  it("BT-005: addNode adds github_check with kind=github_check", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("github_check", { x: 100, y: 100 });
    const nodes = store.getState().nodes;
    const newNode = nodes.find((n) => n.data?.kind === "github_check");
    expect(newNode).toBeDefined();
  });

  it("BT-008: adding a node marks store as dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    expect(store.getState().isDirty).toBe(true);
  });
});

describe("createLoopBuilderStore — connectEdge with when", () => {
  it("BT-006: connectEdge with a valid when value adds an edge", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    const agentNode = store.getState().nodes.find((n) => n.data?.kind === "agent_step");
    expect(agentNode).toBeDefined();

    // Connect start-1 → agentNode with "always"
    store.getState().connectEdge({
      source: "start-1",
      target: agentNode!.id,
      when: "always",
    });
    const edges = store.getState().edges;
    const newEdge = edges.find(
      (e) => e.source === "start-1" && e.target === agentNode!.id,
    );
    expect(newEdge).toBeDefined();
    expect(newEdge?.data?.when).toBe("always");
  });

  it("BT-008: connecting an edge marks store as dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("end", { x: 300, y: 0 });
    const newEnd = store.getState().nodes.find(
      (n, i) => n.data?.kind === "end" && i > 0,
    );
    store.getState().connectEdge({
      source: "start-1",
      target: newEnd?.id ?? "end-1",
      when: "always",
    });
    expect(store.getState().isDirty).toBe(true);
  });
});

describe("createLoopBuilderStore — validation on change", () => {
  it("BT-007: adding a node without outgoing edges produces validation errors", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    // New agent_step node has no outgoing edge → validation error
    const errors = store.getState().validationErrors;
    expect(errors.length).toBeGreaterThan(0);
  });

  it("BT-007: valid definition produces empty validation errors array", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().validationErrors).toHaveLength(0);
  });
});

describe("createLoopBuilderStore — edge when legality", () => {
  it("BT-009: legalWhenValues returns true/false ONLY for condition source nodes", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "start-1", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "cond-1", kind: "condition", label: "C", position: { x: 100, y: 0 } },
        { id: "end-1", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [],
    });

    const condValues = store.getState().legalWhenValues("cond-1");
    expect(condValues).toContain("true");
    expect(condValues).toContain("false");
    expect(condValues).not.toContain("success");
    expect(condValues).not.toContain("failure");
    expect(condValues).not.toContain("always");
  });

  it("BT-009: legalWhenValues returns success/failure/always ONLY for non-condition source nodes", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "start-1", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "step-1", kind: "agent_step", label: "A", position: { x: 100, y: 0 } },
        { id: "end-1", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [],
    });

    const agentValues = store.getState().legalWhenValues("step-1");
    expect(agentValues).toContain("success");
    expect(agentValues).toContain("failure");
    expect(agentValues).toContain("always");
    expect(agentValues).not.toContain("true");
    expect(agentValues).not.toContain("false");

    const startValues = store.getState().legalWhenValues("start-1");
    expect(startValues).toContain("always");
    expect(startValues).not.toContain("true");
    expect(startValues).not.toContain("false");
  });

  it("BT-009: legalWhenValues for github_check returns success/failure/always only", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "start-1", kind: "start", label: "S", position: { x: 0, y: 0 } },
        { id: "gh-1", kind: "github_check", label: "GH", position: { x: 100, y: 0 } },
        { id: "end-1", kind: "end", label: "E", position: { x: 200, y: 0 } },
      ],
      edges: [],
    });

    const ghValues = store.getState().legalWhenValues("gh-1");
    expect(ghValues).toContain("success");
    expect(ghValues).toContain("failure");
    expect(ghValues).not.toContain("true");
    expect(ghValues).not.toContain("false");
  });
});

describe("createLoopBuilderStore — markClean", () => {
  it("BT-008: markClean resets isDirty to false after changes", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    store.getState().addNode("agent_step", { x: 100, y: 100 });
    expect(store.getState().isDirty).toBe(true);
    store.getState().markClean();
    expect(store.getState().isDirty).toBe(false);
  });
});
