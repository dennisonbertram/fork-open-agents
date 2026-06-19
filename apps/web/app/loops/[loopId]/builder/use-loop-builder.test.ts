/**
 * Tests for use-loop-builder.ts — RED commit
 * BT-005: add-node defaults (unique ids, palette kinds)
 * BT-006: onConnect requires explicit when value (no edge until picked)
 * BT-007: validation errors update on graph change
 * BT-008: dirty tracking
 * BT-009: edge when-legality (condition → true/false; others → success/failure/always)
 * BT-D1: dimensions/select change types do NOT mark isDirty (Defect 1)
 * BT-D4: addNode with collision avoidance — 3 nodes never overlap (Defect 4)
 */

import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import { createLoopBuilderStore } from "./use-loop-builder";

// Minimal valid definition (start + end + edge)
const VALID_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "e-1", source: "start-1", target: "end-1", when: "always" }],
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
    const agentNode = store
      .getState()
      .nodes.find((n) => n.data?.kind === "agent_step");
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
    const newEnd = store
      .getState()
      .nodes.find((n, i) => n.data?.kind === "end" && i > 0);
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
        {
          id: "cond-1",
          kind: "condition",
          label: "C",
          position: { x: 100, y: 0 },
        },
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
        {
          id: "step-1",
          kind: "agent_step",
          label: "A",
          position: { x: 100, y: 0 },
        },
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
        {
          id: "gh-1",
          kind: "github_check",
          label: "GH",
          position: { x: 100, y: 0 },
        },
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

// ── Defect 1: dimensions/select changes must NOT mark dirty ──────────────────

describe("BT-D1: onNodesChange — dimensions and select changes do not mark dirty", () => {
  it("BT-D1: applying a 'dimensions' change type leaves isDirty false after initialization", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);

    // Simulate React Flow firing a 'dimensions' change on mount
    store.getState().onNodesChange([
      {
        id: "start-1",
        type: "dimensions",
        dimensions: { width: 180, height: 60 },
        resizing: false,
        setAttributes: false,
      },
    ]);

    expect(store.getState().isDirty).toBe(false);
  });

  it("BT-D1: applying a 'select' change type leaves isDirty false after initialization", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);

    store
      .getState()
      .onNodesChange([{ id: "start-1", type: "select", selected: true }]);

    expect(store.getState().isDirty).toBe(false);
  });

  it("BT-D1: a 'position' change (drag) DOES mark isDirty true", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);

    store.getState().onNodesChange([
      {
        id: "start-1",
        type: "position",
        position: { x: 50, y: 50 },
        dragging: false,
      },
    ]);

    expect(store.getState().isDirty).toBe(true);
  });

  it("BT-D1: a 'remove' change DOES mark isDirty true", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);

    store.getState().onNodesChange([{ id: "end-1", type: "remove" }]);

    expect(store.getState().isDirty).toBe(true);
  });

  it("BT-D1: mixed changes where only dimensions present leave isDirty false", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(store.getState().isDirty).toBe(false);

    // Multiple dimension/select changes simultaneously (React Flow mount batch)
    store.getState().onNodesChange([
      {
        id: "start-1",
        type: "dimensions",
        dimensions: { width: 180, height: 60 },
        resizing: false,
        setAttributes: false,
      },
      { id: "end-1", type: "select", selected: false },
    ]);

    expect(store.getState().isDirty).toBe(false);
  });
});

// ── Defect 4: addNode collision avoidance ────────────────────────────────────

describe("BT-D4: addNode — findFreePosition avoids overlapping existing nodes", () => {
  const CENTER = { x: 400, y: 300 };
  const OVERLAP_THRESHOLD = 120;

  it("BT-D4: adding 3 nodes at the same center produces 3 non-overlapping positions", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });

    const id1 = store.getState().addNode("agent_step", CENTER);
    const id2 = store.getState().addNode("github_check", CENTER);
    const id3 = store.getState().addNode("condition", CENTER);

    const nodes = store.getState().nodes;
    const n1 = nodes.find((n) => n.id === id1)!;
    const n2 = nodes.find((n) => n.id === id2)!;
    const n3 = nodes.find((n) => n.id === id3)!;

    expect(n1).toBeDefined();
    expect(n2).toBeDefined();
    expect(n3).toBeDefined();

    function dist(
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): number {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    expect(dist(n1.position, n2.position)).toBeGreaterThan(OVERLAP_THRESHOLD);
    expect(dist(n1.position, n3.position)).toBeGreaterThan(OVERLAP_THRESHOLD);
    expect(dist(n2.position, n3.position)).toBeGreaterThan(OVERLAP_THRESHOLD);
  });

  it("BT-D4: first node at empty canvas lands exactly at the requested position", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });

    const id = store.getState().addNode("agent_step", CENTER);
    const node = store.getState().nodes.find((n) => n.id === id)!;

    expect(node).toBeDefined();
    expect(node.position.x).toBe(CENTER.x);
    expect(node.position.y).toBe(CENTER.y);
  });
});

// ── BT-P2a: github_check palette default must have a valid check config ───────

describe("BT-P2a: github_check palette default — valid check config", () => {
  it("BT-P2a: new github_check node has a check config (not undefined)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("github_check", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    expect(node?.data?.kind).toBe("github_check");
    if (node?.data?.kind === "github_check") {
      expect(node.data.check).toBeDefined();
    }
  });

  it("BT-P2a: new github_check node check.kind is list_issues", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("github_check", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "github_check") {
      expect(node.data.check?.kind).toBe("list_issues");
    }
  });

  it("BT-P2a: new github_check node check.state is 'open'", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("github_check", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "github_check") {
      if (node.data.check?.kind === "list_issues") {
        expect(node.data.check.state).toBe("open");
      }
    }
  });

  it("BT-P2a: adding github_check to start→end graph + one outgoing edge → validateLoopDefinition ok:true", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "e", kind: "end", label: "End", position: { x: 300, y: 0 } },
      ],
      edges: [{ id: "ed1", source: "s", target: "e", when: "always" }],
    });

    // Add github_check and wire: start→gh (always) + gh→end (success)
    const ghId = store.getState().addNode("github_check", { x: 150, y: 0 });

    // Re-wire: s→gh, gh→e (the existing s→e edge stays for now; add gh→e)
    store.getState().connectEdge({ source: "s", target: ghId, when: "always" });
    store
      .getState()
      .connectEdge({ source: ghId, target: "e", when: "success" });

    const def = store.getState().currentDefinition();
    const result = validateLoopDefinition(def);
    // There will be validation errors from duplicate when on start (two "always" edges)
    // but MUST NOT include missing_node_config or schema_error for github_check
    const hasGithubConfigError =
      !result.ok &&
      result.errors.some(
        (err) =>
          err.rule === "missing_node_config" &&
          "nodeKind" in err &&
          err.nodeKind === "github_check",
      );
    expect(hasGithubConfigError).toBe(false);

    const hasSchemaError =
      !result.ok && result.errors.some((err) => err.rule === "schema_error");
    expect(hasSchemaError).toBe(false);
  });

  it("BT-P2a: github_check node card summary shows 'list issues' text (check.kind rendered)", () => {
    // The card renders data.check?.kind.replaceAll('_', ' ') — verify default kind gives a non-empty summary
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("github_check", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "github_check") {
      const checkKind = node.data.check?.kind;
      expect(checkKind).toBeDefined();
      const summary = checkKind?.replaceAll("_", " ");
      expect(summary).toBe("list issues");
    }
  });
});

// ── BT-P2b: condition palette default must have a non-empty path ──────────────

describe("BT-P2b: condition palette default — non-empty path", () => {
  it("BT-P2b: new condition node has condition.path that is non-empty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("condition", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "condition") {
      expect(node.data.condition?.path).toBeTruthy();
      expect(node.data.condition?.path.length).toBeGreaterThan(0);
    }
  });

  it("BT-P2b: new condition node has condition.op = 'exists'", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("condition", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "condition") {
      expect(node.data.condition?.op).toBe("exists");
    }
  });

  it("BT-P2b: adding condition to start→end graph + two outgoing edges (true/false) → no schema_error", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "e1", kind: "end", label: "End1", position: { x: 300, y: -60 } },
        { id: "e2", kind: "end", label: "End2", position: { x: 300, y: 60 } },
      ],
      edges: [{ id: "ed1", source: "s", target: "e1", when: "always" }],
    });

    const condId = store.getState().addNode("condition", { x: 150, y: 0 });
    store
      .getState()
      .connectEdge({ source: "s", target: condId, when: "always" });
    store
      .getState()
      .connectEdge({ source: condId, target: "e1", when: "true" });
    store
      .getState()
      .connectEdge({ source: condId, target: "e2", when: "false" });

    const def = store.getState().currentDefinition();
    const result = validateLoopDefinition(def);
    const hasSchemaError =
      !result.ok && result.errors.some((err) => err.rule === "schema_error");
    expect(hasSchemaError).toBe(false);
    const hasMissingConfig =
      !result.ok &&
      result.errors.some((err) => err.rule === "missing_node_config");
    expect(hasMissingConfig).toBe(false);
  });

  it("BT-P2b: condition default path is self-explanatory as a placeholder (contains a dot)", () => {
    // The path should be something like 'previous_step.output' — contains a dot
    // to signal it is a context reference, not an empty placeholder.
    const store = createLoopBuilderStore();
    store.getState().initialize({ nodes: [], edges: [] });
    const id = store.getState().addNode("condition", { x: 100, y: 100 });
    const node = store.getState().nodes.find((n) => n.id === id);
    if (node?.data?.kind === "condition") {
      expect(node.data.condition?.path).toContain(".");
    }
  });
});

// ── Auto-connect on add: insert-into-edge (BT-AUTOCONNECT) ─────────────────────

describe("createLoopBuilderStore — addNode auto-connect (insert-into-edge)", () => {
  it("BT-AUTOCONNECT-001: inserting an agent_step from a node splits its edge (S→N→T) and stays valid", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF); // start-1 →(always) end-1

    const newId = store
      .getState()
      .addNode("agent_step", { x: 100, y: 0 }, { connectFrom: "start-1" });

    const edges = store.getState().edges;
    const intoNew = edges.find((e) => e.target === newId);
    const outOfNew = edges.find((e) => e.source === newId);
    // S→N retains the original edge (rewired target); N→T forward edge added
    expect(intoNew?.source).toBe("start-1");
    expect(intoNew?.data?.when).toBe("always");
    expect(outOfNew?.target).toBe("end-1");
    expect(outOfNew?.data?.when).toBe("success");
    // New node has both inbound and outbound → no orphan, graph valid
    expect(store.getState().validationErrors).toHaveLength(0);
  });

  it("BT-AUTOCONNECT-002: the new node is selected (deselecting others) for chaining", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    const newId = store
      .getState()
      .addNode("agent_step", { x: 100, y: 0 }, { connectFrom: "start-1" });
    const selected = store.getState().nodes.filter((n) => n.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe(newId);
  });

  it("BT-AUTOCONNECT-003: without connectFrom no edge is added (orphan, unchanged behavior)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    const edgesBefore = store.getState().edges.length;
    store.getState().addNode("agent_step", { x: 100, y: 0 });
    expect(store.getState().edges).toHaveLength(edgesBefore);
  });

  it("BT-AUTOCONNECT-004: never connects FROM an end node", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    const edgesBefore = store.getState().edges.length;
    store
      .getState()
      .addNode("agent_step", { x: 100, y: 0 }, { connectFrom: "end-1" });
    expect(store.getState().edges).toHaveLength(edgesBefore);
  });

  it("BT-AUTOCONNECT-005: chained inserts (start→a→b→end) keep the graph valid", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    const a = store
      .getState()
      .addNode("agent_step", { x: 100, y: 0 }, { connectFrom: "start-1" });
    // 'a' is now selected; chain a second step off it
    store
      .getState()
      .addNode("agent_step", { x: 200, y: 0 }, { connectFrom: a });
    expect(store.getState().validationErrors).toHaveLength(0);
    expect(store.getState().nodes).toHaveLength(4); // start, end, a, b
  });
});
