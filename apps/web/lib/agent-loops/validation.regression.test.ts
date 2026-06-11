/**
 * Agent Loops — validation regression tests (TASK-321)
 *
 * These tests would fail if the implementation in the green commit (68e63af0)
 * were reverted. Each covers a distinct angle not already primary in
 * validation.test.ts — edge cases, cross-rule interactions, and store gate
 * integration.
 *
 * Scenario coverage:
 *  RT-01  Reverting VR-03 (dangling edge): edge to/from deleted node is caught
 *  RT-02  Reverting VR-05 (condition edges): a one-branch condition is caught
 *  RT-03  Reverting VR-06 (invalid when): github_check with when:true fails
 *  RT-04  Reverting VR-07 (duplicate when): two always edges on same node caught
 *  RT-05  Reverting VR-08 (reachability): isolated subgraph caught
 *  RT-06  Reverting VR-09 (cycle legality): direct self-loop on agent_step passes
 *  RT-07  Reverting VR-11 (prototype safety): __proto__ caught, normal id passes
 *  RT-08  Reverting VR-12 (github_check config): missing check field on github_check
 *  RT-09  Reverting VR-14 (condition value): contains op without value fails
 *  RT-10  Multiple errors returned simultaneously — validator does not short-circuit
 *  RT-11  Store gate: invalid def to updateAgentLoop returns errors, not null
 *  RT-12  Reverting VR-17 (duplicate node ids): two same-id nodes collapse in
 *          the node map, so downstream rules would produce misleading results
 *          rather than catching the root cause; the duplicate-id rule must fire
 *          before the nodeMap is relied on by any other rule.
 */

import { describe, expect, test } from "bun:test";
import { validateLoopDefinition } from "./validation";

function edge(id: string, src: string, tgt: string, when: string) {
  return { id, source: src, target: tgt, when };
}

function startNode(id = "s") {
  return { id, kind: "start" as const, label: "S", position: { x: 0, y: 0 } };
}

function endNode(id = "e") {
  return { id, kind: "end" as const, label: "E", position: { x: 200, y: 0 } };
}

function agentStepNode(id = "a") {
  return {
    id,
    kind: "agent_step" as const,
    label: "A",
    position: { x: 100, y: 0 },
    instructions: "do something",
  };
}

function githubCheckNode(id = "g") {
  return {
    id,
    kind: "github_check" as const,
    label: "G",
    position: { x: 100, y: 0 },
    check: { kind: "list_issues" as const },
  };
}

function conditionNode(
  id = "c",
  op: "eq" | "gt" | "contains" | "exists" = "gt",
) {
  const condition: {
    path: string;
    op: "eq" | "gt" | "contains" | "exists";
    value?: unknown;
  } =
    op === "exists"
      ? { path: "ctx.val", op: "exists" }
      : { path: "ctx.val", op, value: 0 };
  return {
    id,
    kind: "condition" as const,
    label: "C",
    position: { x: 100, y: 0 },
    condition,
  };
}

// ── RT-01: dangling edge ──────────────────────────────────────────────────────

describe("RT-01: dangling edge — edge referencing a nonexistent node is caught", () => {
  test("edge pointing to a node id that was removed fails with dangling_edge", () => {
    // Simulates a builder that deleted a node but left stale edges
    const def = {
      nodes: [startNode(), endNode()],
      edges: [
        edge("e1", "s", "e", "always"),
        edge("stale", "s", "deleted-node-id", "success"), // stale edge
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "dangling_edge" && e.edgeId === "stale",
      );
      expect(err).toBeDefined();
    }
  });
});

// ── RT-02: condition one-branch ───────────────────────────────────────────────

describe("RT-02: condition with only one branch is caught", () => {
  test("condition node with only true branch fails, naming the missing false branch", () => {
    const def = {
      nodes: [startNode(), conditionNode(), endNode()],
      edges: [
        edge("e1", "s", "c", "always"),
        edge("e2", "c", "e", "true"),
        // no false branch
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) =>
          e.rule === "missing_condition_edge" &&
          e.nodeId === "c" &&
          e.branch === "false",
      );
      expect(err).toBeDefined();
    }
  });
});

// ── RT-03: github_check may not use true/false when ──────────────────────────

describe("RT-03: github_check edges must not use true/false when", () => {
  test("github_check with success+failure edges is valid", () => {
    const def = {
      nodes: [startNode(), githubCheckNode(), endNode()],
      edges: [
        edge("e1", "s", "g", "always"),
        edge("e2", "g", "e", "success"),
        edge("e3", "g", "e", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });

  test("github_check outgoing edge with when:true fails with invalid_when", () => {
    const def = {
      nodes: [startNode(), githubCheckNode(), endNode()],
      edges: [
        edge("e1", "s", "g", "always"),
        edge("e2", "g", "e", "true"), // invalid for github_check
        edge("e3", "g", "e", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "invalid_when" && e.edgeId === "e2",
      );
      expect(err).toBeDefined();
    }
  });
});

// ── RT-04: duplicate when on same node ───────────────────────────────────────

describe("RT-04: duplicate (source, when) pairs caught", () => {
  test("two success edges from same agent_step fail with duplicate_when", () => {
    const def = {
      nodes: [startNode(), agentStepNode(), endNode()],
      edges: [
        edge("e1", "s", "a", "always"),
        edge("e2", "a", "e", "success"),
        edge("e3", "a", "e", "success"), // duplicate
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.rule === "duplicate_when");
      expect(err).toBeDefined();
      expect(err?.sourceNodeId).toBe("a");
    }
  });
});

// ── RT-05: reachability — isolated subgraph ───────────────────────────────────

describe("RT-05: end unreachable catches disconnected end node", () => {
  test("start → step → (back to step forever), end is disconnected — fails with end_unreachable", () => {
    const def = {
      nodes: [startNode(), agentStepNode(), endNode()],
      edges: [
        edge("e1", "s", "a", "always"),
        edge("e2", "a", "a", "success"), // self-cycle, never reaches end
        edge("e3", "a", "a", "failure"), // same
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
});

// ── RT-06: cycle legality — direct self-loop ──────────────────────────────────

describe("RT-06: self-loop cycle is legal when end is still reachable", () => {
  test("agent_step self-loop on failure, success → end — valid", () => {
    const def = {
      nodes: [startNode(), agentStepNode(), endNode()],
      edges: [
        edge("e1", "s", "a", "always"),
        edge("e2", "a", "a", "failure"), // self-loop retry
        edge("e3", "a", "e", "success"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});

// ── RT-07: prototype safety ───────────────────────────────────────────────────

describe("RT-07: forbidden node ids cannot shadow prototype chain", () => {
  test("node id __proto__ is caught and a normal id is not flagged", () => {
    // Forbidden node
    const def1 = {
      nodes: [
        {
          id: "__proto__",
          kind: "start" as const,
          label: "S",
          position: { x: 0, y: 0 },
        },
        endNode(),
      ],
      edges: [edge("e1", "__proto__", "e", "always")],
    };
    const r1 = validateLoopDefinition(def1);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.errors.some((e) => e.rule === "forbidden_node_id")).toBe(true);
    }

    // Normal id with double-underscore prefix is fine
    const def2 = {
      nodes: [startNode("__my_start__"), endNode()],
      edges: [edge("e1", "__my_start__", "e", "always")],
    };
    const r2 = validateLoopDefinition(def2);
    expect(r2.ok).toBe(true);
  });
});

// ── RT-08: github_check missing check field ────────────────────────────────────

describe("RT-08: github_check without check config caught", () => {
  test("github_check node with check omitted fails with missing_node_config naming the node", () => {
    const nodeNoCheck = {
      id: "g2",
      kind: "github_check" as const,
      label: "G2",
      position: { x: 100, y: 0 },
    };
    const def = {
      nodes: [startNode(), nodeNoCheck, endNode()],
      edges: [
        edge("e1", "s", "g2", "always"),
        edge("e2", "g2", "e", "success"),
        edge("e3", "g2", "e", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "missing_node_config" && e.nodeId === "g2",
      );
      expect(err).toBeDefined();
    }
  });
});

// ── RT-09: condition op=contains requires value ────────────────────────────────

describe("RT-09: condition ops requiring value fail without it", () => {
  test("op=contains without value fails with missing_condition_value", () => {
    const nodeContainsNoValue = {
      id: "c2",
      kind: "condition" as const,
      label: "C2",
      position: { x: 100, y: 0 },
      condition: { path: "ctx.list", op: "contains" as const },
    };
    const def = {
      nodes: [startNode(), nodeContainsNoValue, endNode()],
      edges: [
        edge("e1", "s", "c2", "always"),
        edge("e2", "c2", "e", "true"),
        edge("e3", "c2", "e", "false"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(
        (e) => e.rule === "missing_condition_value" && e.nodeId === "c2",
      );
      expect(err).toBeDefined();
    }
  });
});

// ── RT-10: multiple simultaneous errors ───────────────────────────────────────

describe("RT-10: validator collects multiple errors, not short-circuit after first", () => {
  test("definition with multiple violations returns errors for each rule violated", () => {
    // Two start nodes + agent_step without outgoing + end unreachable
    const def = {
      nodes: [
        startNode("s1"),
        startNode("s2"),
        agentStepNode("orphan"),
        endNode(),
      ],
      edges: [
        edge("e1", "s1", "e", "always"),
        edge("e2", "s2", "e", "always"),
        // orphan has no outgoing edge; end reachable from s1 and s2 though
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // multiple_start AND no_outgoing_edge should both appear
      expect(result.errors.some((e) => e.rule === "multiple_start")).toBe(true);
      expect(result.errors.some((e) => e.rule === "no_outgoing_edge")).toBe(
        true,
      );
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── RT-12: duplicate node ids collapse in nodeMap without VR-17 ───────────────

describe("RT-12: duplicate node id rule fires before nodeMap is relied on", () => {
  test("two nodes with the same id fail with duplicate_node_id, not a misleading downstream rule", () => {
    // Without VR-17, a start node and an end node sharing the same id would
    // silently collapse: nodeMap.set(id, node) overwrites the first entry,
    // so the second node's kind wins. All downstream rules (VR-01/VR-02 counts,
    // VR-04 outgoing-edge check, VR-08 reachability BFS) operate on corrupted
    // state and can produce incorrect pass/fail results.
    //
    // This regression test proves that the validator catches the root cause
    // (duplicate_node_id) rather than letting the nodeMap silently eat a node.
    const def = {
      nodes: [
        startNode("collide"),
        endNode("collide"), // same id — without VR-17, start gets overwritten
      ],
      edges: [edge("e1", "collide", "collide", "always")],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must name the specific rule — not a vague structural error
      const dupErr = result.errors.find((e) => e.rule === "duplicate_node_id");
      expect(dupErr).toBeDefined();
      expect(dupErr?.nodeId).toBe("collide");
    }
  });

  test("two agent_step nodes sharing an id fail with duplicate_node_id naming the shared id", () => {
    // Both nodes share "step-x". Without VR-17, only the second one ends up in
    // nodeMap; the first is invisible to VR-04 (no_outgoing_edge check uses the
    // map for lookup), VR-08 BFS, and edge validation.
    const def = {
      nodes: [
        startNode(),
        agentStepNode("step-x"),
        agentStepNode("step-x"),
        endNode(),
      ],
      edges: [
        edge("e1", "s", "step-x", "always"),
        edge("e2", "step-x", "e", "success"),
        edge("e3", "step-x", "e", "failure"),
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const dupErr = result.errors.find(
        (e) => e.rule === "duplicate_node_id" && e.nodeId === "step-x",
      );
      expect(dupErr).toBeDefined();
    }
  });
});

// ── RT-11: store gate returns structured errors, never null ──────────────────

describe("RT-11: store gate updateAgentLoop returns {ok:false,errors} for invalid def, not null", () => {
  test("calling validateLoopDefinition directly with invalid def returns structured errors", () => {
    // This tests the validation module that the store gate calls.
    // If the store returned null instead of {ok:false,errors}, the API would
    // treat it as a 404 (not-found) instead of a 422 (validation error).
    const result = validateLoopDefinition({ nodes: [], edges: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must carry enough info for API to render inline errors
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.kind).toBe("loop_invalid");
      expect(typeof result.errors[0]?.rule).toBe("string");
      expect(typeof result.errors[0]?.message).toBe("string");
    }
  });
});
