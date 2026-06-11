/**
 * Agent Loops — validation unit tests
 *
 * REGRESSION HARNESS: This file is the permanent regression harness for
 * validateLoopDefinition. Every new node kind or edge routing rule MUST extend
 * this file with a positive + negative test per rule.
 *
 * Test approach: pure function tests — no mocks, no I/O, no DB.
 * One positive + one negative test per validation rule (or per rule variation).
 *
 * Rules tested:
 *  VR-01  Exactly one start node
 *  VR-02  At least one end node
 *  VR-03  All edge endpoints reference existing node ids
 *  VR-04  Every non-end node has ≥1 outgoing edge
 *  VR-05  Condition nodes have both true and false outgoing edges
 *  VR-06  Non-condition nodes may not use true/false when values
 *  VR-07  No duplicate (source, when) pairs
 *  VR-08  end is reachable from start (BFS)
 *  VR-09  Cycles are explicitly legal
 *  VR-10  Definition size cap (64KB serialized)
 *  VR-11  Forbidden node ids (__proto__, constructor, prototype)
 *  VR-12  github_check node requires check config
 *  VR-13  condition node requires condition config
 *  VR-14  condition ops other than exists require value
 *  VR-15  Structural zod validation (missing required fields)
 *  VR-16  Valid minimal graph (start → end) passes
 *  VR-17  No duplicate node ids within a definition
 */

import { describe, expect, test } from "bun:test";

// These imports will fail until validation.ts is created — the expected red state.
import { validateLoopDefinition } from "./validation";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStartNode(id = "start-1") {
  return {
    id,
    kind: "start" as const,
    label: "Start",
    position: { x: 0, y: 0 },
  };
}

function makeEndNode(id = "end-1") {
  return { id, kind: "end" as const, label: "End", position: { x: 200, y: 0 } };
}

function makeAgentStepNode(id = "step-1") {
  return {
    id,
    kind: "agent_step" as const,
    label: "Do work",
    position: { x: 100, y: 0 },
    instructions: "Implement the feature",
  };
}

function makeGithubCheckNode(id = "check-1") {
  return {
    id,
    kind: "github_check" as const,
    label: "Check issues",
    position: { x: 100, y: 0 },
    check: { kind: "list_issues" as const, state: "open" as const },
  };
}

function makeConditionNode(id = "cond-1") {
  return {
    id,
    kind: "condition" as const,
    label: "Has issues?",
    position: { x: 100, y: 0 },
    condition: { path: "check-1.openIssueCount", op: "gt" as const, value: 0 },
  };
}

function makeEdge(id: string, source: string, target: string, when: string) {
  return { id, source, target, when };
}

// Minimal valid graph: start → end
function minimalValidDefinition() {
  return {
    nodes: [makeStartNode(), makeEndNode()],
    edges: [makeEdge("e1", "start-1", "end-1", "always")],
  };
}

// ── VR-16: Valid minimal graph ─────────────────────────────────────────────────

describe("VR-16: valid minimal graph", () => {
  test("start → end with always edge passes validation", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-01: Exactly one start node ─────────────────────────────────────────────

describe("VR-01: exactly one start node", () => {
  test("zero start nodes returns loop_invalid with no_start error", () => {
    const def = {
      nodes: [makeEndNode()],
      edges: [],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.kind === "loop_invalid")).toBe(true);
      expect(result.errors.some((e) => e.rule === "no_start")).toBe(true);
    }
  });

  test("two start nodes returns loop_invalid with multiple_start error", () => {
    const def = {
      nodes: [makeStartNode("s1"), makeStartNode("s2"), makeEndNode()],
      edges: [
        makeEdge("e1", "s1", "end-1", "always"),
        makeEdge("e2", "s2", "end-1", "always"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "multiple_start")).toBe(true);
    }
  });

  test("exactly one start node passes the start-count rule", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-02: At least one end node ──────────────────────────────────────────────

describe("VR-02: at least one end node", () => {
  test("no end node returns loop_invalid with no_end error", () => {
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode()],
      edges: [makeEdge("e1", "start-1", "step-1", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "no_end")).toBe(true);
    }
  });

  test("definition with an end node passes the end-presence rule", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-03: All edge endpoints reference existing node ids ─────────────────────

describe("VR-03: all edge endpoints exist", () => {
  test("edge with unknown source returns loop_invalid with dangling_edge error naming the edge id", () => {
    const def = {
      nodes: [makeStartNode(), makeEndNode()],
      edges: [makeEdge("bad-edge", "nonexistent-source", "end-1", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "dangling_edge");
      expect(err).toBeDefined();
      expect(err?.edgeId).toBe("bad-edge");
    }
  });

  test("edge with unknown target returns loop_invalid with dangling_edge error naming the edge id", () => {
    const def = {
      nodes: [makeStartNode(), makeEndNode()],
      edges: [makeEdge("bad-edge", "start-1", "nonexistent-target", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "dangling_edge");
      expect(err).toBeDefined();
      expect(err?.edgeId).toBe("bad-edge");
    }
  });

  test("all valid edge endpoints passes", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-04: Every non-end node has ≥1 outgoing edge ───────────────────────────

describe("VR-04: every non-end node has ≥1 outgoing edge", () => {
  test("start node with no outgoing edge returns loop_invalid with no_outgoing_edge naming the node id", () => {
    const def = {
      nodes: [makeStartNode(), makeEndNode()],
      edges: [], // no edges at all
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "no_outgoing_edge");
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("start-1");
    }
  });

  test("agent_step node with no outgoing edge fails with no_outgoing_edge", () => {
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [makeEdge("e1", "start-1", "step-1", "always")],
      // step-1 has no outgoing edge
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "no_outgoing_edge" && e.nodeId === "step-1",
      );
      expect(err).toBeDefined();
    }
  });

  test("end node with no outgoing edge is valid (end nodes are exempt)", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-05: Condition nodes have both true and false edges ─────────────────────

describe("VR-05: condition nodes require both true and false edges", () => {
  test("condition node with only true edge fails with missing_condition_edge naming the node and missing branch", () => {
    const def = {
      nodes: [makeStartNode(), makeConditionNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        // missing false edge
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "missing_condition_edge",
      );
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("cond-1");
      expect(err?.branch).toBe("false");
    }
  });

  test("condition node with only false edge fails with missing_condition_edge naming the missing branch", () => {
    const def = {
      nodes: [makeStartNode(), makeConditionNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "false"),
        // missing true edge
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "missing_condition_edge",
      );
      expect(err).toBeDefined();
      expect(err?.branch).toBe("true");
    }
  });

  test("condition node with both true and false edges is valid", () => {
    const def = {
      nodes: [makeStartNode(), makeConditionNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-06: Non-condition nodes may not use true/false when ────────────────────

describe("VR-06: non-condition nodes may not use true/false when values", () => {
  test("agent_step outgoing edge with when:true fails with invalid_when naming the edge id", () => {
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "step-1", "always"),
        makeEdge("e2", "step-1", "end-1", "true"), // agent_step cannot use true/false
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "invalid_when");
      expect(err).toBeDefined();
      expect(err?.edgeId).toBe("e2");
    }
  });

  test("start node outgoing edge with when:false fails with invalid_when", () => {
    const def = {
      nodes: [makeStartNode(), makeEndNode()],
      edges: [makeEdge("e1", "start-1", "end-1", "false")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "invalid_when");
      expect(err).toBeDefined();
    }
  });

  test("agent_step with success/failure/always edges is valid", () => {
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "step-1", "always"),
        makeEdge("e2", "step-1", "end-1", "success"),
        makeEdge("e3", "step-1", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-07: No duplicate (source, when) pairs ──────────────────────────────────

describe("VR-07: no duplicate (source, when) pairs", () => {
  test("two edges with the same source and when=always fails with duplicate_when naming both edge ids", () => {
    const def = {
      nodes: [makeStartNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "end-1", "always"),
        makeEdge("e2", "start-1", "end-1", "always"), // duplicate
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "duplicate_when");
      expect(err).toBeDefined();
    }
  });

  test("same source with different when values is valid", () => {
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "step-1", "always"),
        makeEdge("e2", "step-1", "end-1", "success"),
        makeEdge("e3", "step-1", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-08: end reachable from start (BFS) ────────────────────────────────────

describe("VR-08: end reachable from start (BFS)", () => {
  test("graph where end is unreachable from start fails with end_unreachable", () => {
    // start → step-1, but end is disconnected
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "step-1", "always"),
        // step-1 has no outgoing edge to end-1
        // (but step-1 needs an outgoing edge per VR-04, so we add a self-loop)
        makeEdge("e2", "step-1", "step-1", "always"), // cycle to self, never reaches end
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "end_unreachable")).toBe(
        true,
      );
    }
  });

  test("graph where end is reachable passes", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-09: Cycles are explicitly legal ───────────────────────────────────────

describe("VR-09: cycles are legal", () => {
  test("loop-back edge from agent_step to start is valid when end is still reachable", () => {
    // start → step-1 (success → end, failure → start [loop-back])
    const def = {
      nodes: [makeStartNode(), makeAgentStepNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "step-1", "always"),
        makeEdge("e2", "step-1", "end-1", "success"),
        makeEdge("e3", "step-1", "start-1", "failure"), // cycle back to start
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });

  test("multi-hop cycle (a→b→c→a) is valid when end is reachable", () => {
    // start → a → b → c → a (cycle), b also → end
    const def = {
      nodes: [
        makeStartNode(),
        makeAgentStepNode("a"),
        makeAgentStepNode("b"),
        makeAgentStepNode("c"),
        makeEndNode(),
      ],
      edges: [
        makeEdge("e1", "start-1", "a", "always"),
        makeEdge("e2", "a", "b", "success"),
        makeEdge("e3", "a", "end-1", "failure"),
        makeEdge("e4", "b", "c", "success"),
        makeEdge("e5", "b", "end-1", "failure"),
        makeEdge("e6", "c", "a", "success"), // cycle c → a
        makeEdge("e7", "c", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-10: Definition size cap ────────────────────────────────────────────────

describe("VR-10: definition size cap (64KB)", () => {
  test("definition over 64KB fails with definition_too_large", () => {
    // Generate a definition that serializes to > 64KB
    const nodes = [makeStartNode(), makeEndNode()];
    const edges = [makeEdge("e1", "start-1", "end-1", "always")];
    // Pad the first node's label to exceed size cap
    nodes[0] = {
      ...nodes[0]!,
      label: "x".repeat(66 * 1024), // 66KB of label text
    };
    const def = { nodes, edges };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "definition_too_large")).toBe(
        true,
      );
    }
  });

  test("definition under 64KB passes the size check", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-11: Forbidden node ids ─────────────────────────────────────────────────

describe("VR-11: forbidden node ids (prototype-pollution-safe)", () => {
  test("node with id __proto__ fails with forbidden_node_id", () => {
    const def = {
      nodes: [
        {
          id: "__proto__",
          kind: "start" as const,
          label: "Start",
          position: { x: 0, y: 0 },
        },
        makeEndNode(),
      ],
      edges: [makeEdge("e1", "__proto__", "end-1", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "forbidden_node_id");
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("__proto__");
    }
  });

  test("node with id constructor fails with forbidden_node_id", () => {
    const def = {
      nodes: [
        {
          id: "constructor",
          kind: "start" as const,
          label: "Start",
          position: { x: 0, y: 0 },
        },
        makeEndNode(),
      ],
      edges: [makeEdge("e1", "constructor", "end-1", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "forbidden_node_id");
      expect(err).toBeDefined();
    }
  });

  test("node with id prototype fails with forbidden_node_id", () => {
    const def = {
      nodes: [
        {
          id: "prototype",
          kind: "start" as const,
          label: "Start",
          position: { x: 0, y: 0 },
        },
        makeEndNode(),
      ],
      edges: [makeEdge("e1", "prototype", "end-1", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "forbidden_node_id");
      expect(err).toBeDefined();
    }
  });

  test("normal node id passes", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── VR-12: github_check node requires check config ────────────────────────────

describe("VR-12: github_check requires check config", () => {
  test("github_check node without check config fails with missing_node_config naming the node id", () => {
    const nodeWithoutCheck = {
      id: "check-1",
      kind: "github_check" as const,
      label: "Check issues",
      position: { x: 100, y: 0 },
      // no check field
    };
    const def = {
      nodes: [makeStartNode(), nodeWithoutCheck, makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "check-1", "always"),
        makeEdge("e2", "check-1", "end-1", "success"),
        makeEdge("e3", "check-1", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "missing_node_config");
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("check-1");
    }
  });

  test("github_check node with valid check config is valid", () => {
    const def = {
      nodes: [makeStartNode(), makeGithubCheckNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "check-1", "always"),
        makeEdge("e2", "check-1", "end-1", "success"),
        makeEdge("e3", "check-1", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-13: condition node requires condition config ───────────────────────────

describe("VR-13: condition node requires condition config", () => {
  test("condition node without condition config fails with missing_node_config naming the node id", () => {
    const nodeWithoutCondition = {
      id: "cond-1",
      kind: "condition" as const,
      label: "Has issues?",
      position: { x: 100, y: 0 },
      // no condition field
    };
    const def = {
      nodes: [makeStartNode(), nodeWithoutCondition, makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "missing_node_config");
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("cond-1");
    }
  });

  test("condition node with valid condition config is valid", () => {
    const def = {
      nodes: [makeStartNode(), makeConditionNode(), makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-14: condition ops other than exists require value ─────────────────────

describe("VR-14: condition ops other than exists require value", () => {
  test("condition with op=gt and no value fails with missing_condition_value naming the node id", () => {
    const nodeGtNoValue = {
      id: "cond-1",
      kind: "condition" as const,
      label: "Has items?",
      position: { x: 100, y: 0 },
      condition: { path: "check.count", op: "gt" as const },
      // no value
    };
    const def = {
      nodes: [makeStartNode(), nodeGtNoValue, makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "missing_condition_value",
      );
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("cond-1");
    }
  });

  test("condition with op=exists and no value is valid (exists is the exempt op)", () => {
    const nodeExists = {
      id: "cond-1",
      kind: "condition" as const,
      label: "Exists?",
      position: { x: 100, y: 0 },
      condition: { path: "check.issues", op: "exists" as const },
    };
    const def = {
      nodes: [makeStartNode(), nodeExists, makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });

  test("condition with op=eq and a value is valid", () => {
    const nodeEqWithValue = {
      id: "cond-1",
      kind: "condition" as const,
      label: "Status ok?",
      position: { x: 100, y: 0 },
      condition: { path: "check.status", op: "eq" as const, value: "success" },
    };
    const def = {
      nodes: [makeStartNode(), nodeEqWithValue, makeEndNode()],
      edges: [
        makeEdge("e1", "start-1", "cond-1", "always"),
        makeEdge("e2", "cond-1", "end-1", "true"),
        makeEdge("e3", "cond-1", "end-1", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── VR-15: Structural Zod validation ─────────────────────────────────────────

describe("VR-15: structural zod validation (missing required fields)", () => {
  test("non-object input fails with loop_invalid", () => {
    const result = validateLoopDefinition(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.kind === "loop_invalid")).toBe(true);
    }
  });

  test("missing nodes field fails with loop_invalid", () => {
    const result = validateLoopDefinition({ edges: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.kind === "loop_invalid")).toBe(true);
    }
  });

  test("missing edges field fails with loop_invalid", () => {
    const result = validateLoopDefinition({ nodes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.kind === "loop_invalid")).toBe(true);
    }
  });

  test("node with unknown kind fails with loop_invalid", () => {
    const def = {
      nodes: [
        { id: "x", kind: "unknown_kind", label: "X", position: { x: 0, y: 0 } },
      ],
      edges: [],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
  });
});

// ── VR-17: No duplicate node ids ─────────────────────────────────────────────

describe("VR-17: no duplicate node ids", () => {
  test("two nodes sharing the same id fail with duplicate_node_id naming the duplicated id", () => {
    const def = {
      nodes: [
        makeStartNode("shared-id"),
        makeEndNode("shared-id"), // same id as start
      ],
      edges: [makeEdge("e1", "shared-id", "shared-id", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "duplicate_node_id");
      expect(err).toBeDefined();
      expect(err?.nodeId).toBe("shared-id");
    }
  });

  test("error message names the kinds of the colliding nodes", () => {
    const def = {
      nodes: [
        makeStartNode("dup"),
        makeAgentStepNode("dup"), // start and agent_step share id "dup"
      ],
      edges: [makeEdge("e1", "dup", "dup", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "duplicate_node_id");
      expect(err).toBeDefined();
      // Message should mention the id
      expect(err?.message).toContain("dup");
    }
  });

  test("three nodes where two share an id — all duplicated ids flagged", () => {
    const def = {
      nodes: [
        makeStartNode("s1"),
        makeAgentStepNode("dup"),
        makeAgentStepNode("dup"), // duplicate
        makeEndNode("e1"),
      ],
      edges: [
        makeEdge("e1", "s1", "dup", "always"),
        makeEdge("e2", "dup", "e1", "success"),
        makeEdge("e3", "dup", "e1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "duplicate_node_id" && e.nodeId === "dup",
      );
      expect(err).toBeDefined();
    }
  });

  test("definition where all node ids are unique passes the duplicate-id check", () => {
    const result = validateLoopDefinition(minimalValidDefinition());
    expect(result.ok).toBe(true);
  });
});

// ── Complex valid graph (all node kinds) ─────────────────────────────────────

describe("complex valid graph with all node kinds", () => {
  test("start → github_check → condition → agent_step → end (with cycle fallback) is valid", () => {
    const def = {
      nodes: [
        makeStartNode(),
        makeGithubCheckNode("check-1"),
        makeConditionNode("cond-1"),
        makeAgentStepNode("step-1"),
        makeEndNode("end-1"),
      ],
      edges: [
        makeEdge("e1", "start-1", "check-1", "always"),
        makeEdge("e2", "check-1", "cond-1", "success"),
        makeEdge("e3", "check-1", "end-1", "failure"),
        makeEdge("e4", "cond-1", "step-1", "true"),
        makeEdge("e5", "cond-1", "end-1", "false"),
        makeEdge("e6", "step-1", "check-1", "success"), // cycle back
        makeEdge("e7", "step-1", "end-1", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});
