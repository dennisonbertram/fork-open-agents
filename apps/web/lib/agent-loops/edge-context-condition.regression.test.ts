/**
 * Agent Loops — regression harness for M1-03 (edge evaluator, context, condition)
 *
 * These tests would fail if the change in feat(loops) TASK-322 were reverted.
 * They cover cross-cutting and edge-case scenarios beyond the main matrices.
 *
 * Scenarios:
 *   R-01  evaluateEdges with a cycle definition: loop-back edge resolves correctly
 *   R-02  evaluateEdges: always edge is NOT used when a direct outcome match exists
 *   R-03  mergeStepOutput: single oversized value that by itself exceeds cap
 *         is still stored (the only key cannot be dropped — loop breaks with one key)
 *   R-04  mergeStepOutput: existing key is replaced, not duplicated, and result is a
 *         stable context (no ghost entries)
 *   R-05  lookupContextPath: deeply nested (3+ levels) path resolves correctly
 *   R-06  lookupContextPath: path containing only a forbidden segment returns found:false
 *   R-07  evaluateCondition: exists is true for false boolean at path (not confused with
 *         falsy check)
 *   R-08  evaluateCondition: contains array with numeric values matches a number needle
 *   R-09  evaluateCondition: neq with different primitive types (boolean vs number) is a
 *         type mismatch, not a silent true
 *   R-10  evaluateEdges: always edge from start node is the only routing path (no outcome
 *         edges on start) — picks always correctly for any outcome
 */

import { describe, expect, test } from "bun:test";

import { evaluateEdges } from "./edge-evaluator";
import { lookupContextPath, mergeStepOutput } from "./context";
import { evaluateCondition } from "./condition";
import type { LoopDefinition } from "./types";

// ── R-01: cycle definition loops back correctly ───────────────────────────────

describe("regression R-01: cycle loop-back edge", () => {
  test("failure outcome on a step with a loop-back failure edge returns the loop-back target", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "start-1",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
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
        // loop-back on failure
        { id: "e2", source: "step-1", target: "step-1", when: "failure" },
        { id: "e3", source: "step-1", target: "end-1", when: "success" },
      ],
    };
    const result = evaluateEdges(def, "step-1", "failure");
    expect(result.nextNodeId).toBe("step-1");
    expect(result.edgeId).toBe("e2");
  });
});

// ── R-02: always NOT used when direct match exists ────────────────────────────

describe("regression R-02: direct match wins over always", () => {
  test("when a node has both a success edge and an always edge, success outcome picks the success edge", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "start-1",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step-1",
          kind: "agent_step",
          label: "Step",
          position: { x: 100, y: 0 },
        },
        { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
        {
          id: "fallback-1",
          kind: "end",
          label: "Fallback",
          position: { x: 200, y: 100 },
        },
      ],
      edges: [
        { id: "e1", source: "start-1", target: "step-1", when: "always" },
        { id: "e2", source: "step-1", target: "end-1", when: "success" },
        { id: "e3", source: "step-1", target: "fallback-1", when: "always" },
      ],
    };
    // success outcome should pick the success edge, NOT the always edge
    const result = evaluateEdges(def, "step-1", "success");
    expect(result.nextNodeId).toBe("end-1");
    expect(result.edgeId).toBe("e2");
    // but failure with only an always edge falls back to always
    const fallbackResult = evaluateEdges(def, "step-1", "failure");
    expect(fallbackResult.nextNodeId).toBe("fallback-1");
    expect(fallbackResult.edgeId).toBe("e3");
  });
});

// ── R-03: single oversized value retained ─────────────────────────────────────

describe("regression R-03: single oversized value retained", () => {
  test("a single value that exceeds 64KB by itself is still stored (cannot drop the only key)", () => {
    // A value that alone is > 64KB
    const hugeValue = "x".repeat(70 * 1024);
    const result = mergeStepOutput({}, "step-1", { data: hugeValue });
    // The only key must still be present even if it exceeds the cap
    expect("step-1" in result.context).toBe(true);
  });
});

// ── R-04: existing key replaced, no ghost entries ────────────────────────────

describe("regression R-04: key replacement produces clean context", () => {
  test("merging the same nodeId twice yields exactly one entry for that nodeId", () => {
    const ctx = {};
    const r1 = mergeStepOutput(ctx, "step-1", { version: 1 });
    const r2 = mergeStepOutput(r1.context, "step-1", { version: 2 });
    const keys = Object.keys(r2.context);
    expect(keys.filter((k) => k === "step-1").length).toBe(1);
    expect(r2.context["step-1"]).toEqual({ version: 2 });
  });
});

// ── R-05: deeply nested path lookup ──────────────────────────────────────────

describe("regression R-05: deeply nested path lookup", () => {
  test("lookupContextPath resolves a three-segment path correctly", () => {
    const nestedCtx = { "step-1": { result: { pr: { number: 42 } } } };
    const result = lookupContextPath(nestedCtx, "step-1.result.pr.number");
    expect(result).toEqual({ found: true, value: 42 });
  });
});

// ── R-06: path is only a forbidden segment ────────────────────────────────────

describe("regression R-06: path is a single forbidden segment", () => {
  test("lookupContextPath returns found:false when path is exactly __proto__", () => {
    const result = lookupContextPath({}, "__proto__");
    expect(result).toEqual({ found: false });
  });
});

// ── R-07: exists is true for false boolean ────────────────────────────────────

describe("regression R-07: exists true for false boolean", () => {
  test("exists returns ok:true result:true when the path value is boolean false", () => {
    const result = evaluateCondition(
      { path: "step.done", op: "exists" },
      { step: { done: false } },
    );
    expect(result).toEqual({ ok: true, result: true });
  });
});

// ── R-08: contains array with number needle ───────────────────────────────────

describe("regression R-08: contains array with number needle", () => {
  test("contains returns ok:true result:true when number array includes the number needle", () => {
    const result = evaluateCondition(
      { path: "step.ids", op: "contains", value: 42 },
      { step: { ids: [1, 42, 100] } },
    );
    expect(result).toEqual({ ok: true, result: true });
  });
});

// ── R-09: neq boolean vs number is type mismatch ─────────────────────────────

describe("regression R-09: neq boolean vs number is type mismatch", () => {
  test("neq returns condition_type_mismatch when context is boolean and condition value is number", () => {
    const result = evaluateCondition(
      { path: "step.done", op: "neq", value: 0 },
      { step: { done: false } },
    );
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── R-10: start node with only always edge resolves for any outcome ───────────

describe("regression R-10: always edge on start resolves for any outcome", () => {
  test("start node with only an always edge resolves for success/failure/true/false outcomes", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "start-1",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
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
    for (const outcome of ["success", "failure", "true", "false"] as const) {
      const result = evaluateEdges(def, "start-1", outcome);
      expect(result.nextNodeId).toBe("step-1");
      expect(result.edgeId).toBe("e1");
    }
  });
});
