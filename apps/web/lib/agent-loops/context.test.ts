/**
 * Agent Loops — context utilities unit tests (TDD RED)
 *
 * mergeStepOutput tests:
 *   CT-01  Merges output under the node id key
 *   CT-02  Multiple merges accumulate correctly
 *   CT-03  Does not throw on weird/null values
 *   CT-04  Under-cap merge → truncated: false
 *   CT-05  Over-cap merge drops OLDEST keys first → truncated: true
 *   CT-06  After truncation result is under 64KB
 *   CT-07  Replacement of existing key for same node keeps context under cap
 *
 * lookupContextPath tests:
 *   CT-10  Dot-path lookup on nested object returns found: true, value
 *   CT-11  Missing path returns found: false
 *   CT-12  Partially missing path returns found: false
 *   CT-13  __proto__ segment → found: false
 *   CT-14  constructor segment → found: false
 *   CT-15  prototype segment → found: false
 *   CT-16  Shallow lookup (no dots) works
 *   CT-17  Lookup on array value at path works
 *   CT-18  Empty string path → found: false
 */

import { describe, expect, test } from "bun:test";
import { lookupContextPath, mergeStepOutput } from "./context";

const CONTEXT_CAP_BYTES = 64 * 1024; // 64KB

// ── CT-01: Merges output under node id key ───────────────────────────────────

describe("mergeStepOutput — CT-01 merge under node id", () => {
  test("output appears in result context keyed by nodeId", () => {
    const ctx = {};
    const result = mergeStepOutput(ctx, "step-1", { count: 3, branch: "main" });
    expect(result.context).toEqual({ "step-1": { count: 3, branch: "main" } });
    expect(result.truncated).toBe(false);
  });
});

// ── CT-02: Multiple merges accumulate ────────────────────────────────────────

describe("mergeStepOutput — CT-02 multiple merges", () => {
  test("successive merges accumulate all node outputs", () => {
    const ctx = {};
    const r1 = mergeStepOutput(ctx, "check-1", { issueCount: 5 });
    const r2 = mergeStepOutput(r1.context, "step-1", { branch: "feat/x" });
    expect(r2.context).toEqual({
      "check-1": { issueCount: 5 },
      "step-1": { branch: "feat/x" },
    });
    expect(r2.truncated).toBe(false);
  });
});

// ── CT-03: Does not throw on weird/null values ────────────────────────────────

describe("mergeStepOutput — CT-03 never throws", () => {
  test("does not throw when output is null", () => {
    expect(() => mergeStepOutput({}, "step-1", null)).not.toThrow();
  });

  test("does not throw when output is undefined", () => {
    expect(() => mergeStepOutput({}, "step-1", undefined)).not.toThrow();
  });

  test("does not throw when output is a number", () => {
    expect(() => mergeStepOutput({}, "step-1", 42)).not.toThrow();
  });

  test("does not throw when output is an empty object", () => {
    expect(() => mergeStepOutput({}, "step-1", {})).not.toThrow();
  });
});

// ── CT-04: Under-cap merge → truncated: false ─────────────────────────────────

describe("mergeStepOutput — CT-04 under cap", () => {
  test("returns truncated: false when context is well under 64KB", () => {
    const result = mergeStepOutput({}, "step-1", { x: 1 });
    expect(result.truncated).toBe(false);
  });
});

// ── CT-05: Over-cap → drops oldest first, truncated: true ────────────────────

describe("mergeStepOutput — CT-05 over cap drops oldest keys", () => {
  test("drops the oldest node key first when adding output would exceed 64KB", () => {
    // Each 22KB value. Two nodes = 44KB (under cap). Adding a third = ~66KB (over).
    const largeValue = "x".repeat(22 * 1024); // 22KB string
    let ctx: Record<string, unknown> = {};
    // Add node-A (oldest), then node-B — together ~44KB (under cap)
    ctx = mergeStepOutput(ctx, "node-A", { data: largeValue }).context;
    ctx = mergeStepOutput(ctx, "node-B", { data: largeValue }).context;
    // Now add node-C which pushes it over 64KB
    const result = mergeStepOutput(ctx, "node-C", { data: largeValue });
    // Must be truncated
    expect(result.truncated).toBe(true);
    // node-A (oldest) must be dropped
    expect("node-A" in result.context).toBe(false);
    // node-C (newest) must be present
    expect("node-C" in result.context).toBe(true);
  });
});

// ── CT-06: After truncation result is under 64KB ─────────────────────────────

describe("mergeStepOutput — CT-06 after truncation is under cap", () => {
  test("serialized context after truncation is under 64KB", () => {
    const largeValue = "x".repeat(22 * 1024);
    let ctx: Record<string, unknown> = {};
    ctx = mergeStepOutput(ctx, "node-A", { data: largeValue }).context;
    ctx = mergeStepOutput(ctx, "node-B", { data: largeValue }).context;
    const result = mergeStepOutput(ctx, "node-C", { data: largeValue });
    const serializedSize = new TextEncoder().encode(JSON.stringify(result.context)).length;
    expect(serializedSize).toBeLessThan(CONTEXT_CAP_BYTES);
  });
});

// ── CT-07: Replacement of existing key keeps under cap ───────────────────────

describe("mergeStepOutput — CT-07 replacing existing key", () => {
  test("replaces existing node key on second merge for the same node", () => {
    const ctx = {};
    const r1 = mergeStepOutput(ctx, "step-1", { a: 1 });
    const r2 = mergeStepOutput(r1.context, "step-1", { b: 2 });
    // The key is updated, not appended
    expect(r2.context["step-1"]).toEqual({ b: 2 });
  });
});

// ── CT-10: Dot-path lookup nested ────────────────────────────────────────────

describe("lookupContextPath — CT-10 nested lookup", () => {
  test("returns found: true and value for a dot-path to a nested key", () => {
    const ctx = { "check-1": { openIssueCount: 3 } };
    const result = lookupContextPath(ctx, "check-1.openIssueCount");
    expect(result).toEqual({ found: true, value: 3 });
  });
});

// ── CT-11: Missing path → found: false ───────────────────────────────────────

describe("lookupContextPath — CT-11 missing path", () => {
  test("returns found: false when the top-level key does not exist", () => {
    const ctx = {};
    const result = lookupContextPath(ctx, "missing-node.someValue");
    expect(result).toEqual({ found: false });
  });
});

// ── CT-12: Partially missing path ────────────────────────────────────────────

describe("lookupContextPath — CT-12 partially missing path", () => {
  test("returns found: false when a nested key does not exist", () => {
    const ctx = { "step-1": { branch: "main" } };
    const result = lookupContextPath(ctx, "step-1.nonexistentKey");
    expect(result).toEqual({ found: false });
  });
});

// ── CT-13: __proto__ segment rejected ────────────────────────────────────────

describe("lookupContextPath — CT-13 __proto__ segment", () => {
  test("returns found: false when path contains __proto__", () => {
    const ctx = { "step-1": { data: "value" } };
    const result = lookupContextPath(ctx, "step-1.__proto__.polluted");
    expect(result).toEqual({ found: false });
  });
});

// ── CT-14: constructor segment rejected ──────────────────────────────────────

describe("lookupContextPath — CT-14 constructor segment", () => {
  test("returns found: false when path contains constructor", () => {
    const ctx = { "step-1": { data: "value" } };
    const result = lookupContextPath(ctx, "step-1.constructor.name");
    expect(result).toEqual({ found: false });
  });
});

// ── CT-15: prototype segment rejected ────────────────────────────────────────

describe("lookupContextPath — CT-15 prototype segment", () => {
  test("returns found: false when path contains prototype", () => {
    const ctx = { "step-1": {} };
    const result = lookupContextPath(ctx, "step-1.prototype.something");
    expect(result).toEqual({ found: false });
  });
});

// ── CT-16: Shallow lookup (no dots) ─────────────────────────────────────────

describe("lookupContextPath — CT-16 shallow lookup", () => {
  test("returns found: true and value for a single-segment path", () => {
    const ctx = { "check-1": { count: 5 } };
    const result = lookupContextPath(ctx, "check-1");
    expect(result).toEqual({ found: true, value: { count: 5 } });
  });
});

// ── CT-17: Lookup on array value ──────────────────────────────────────────────

describe("lookupContextPath — CT-17 array value at path", () => {
  test("returns found: true and the array when path points to an array", () => {
    const ctx = { "check-1": { issues: [{ id: 1 }, { id: 2 }] } };
    const result = lookupContextPath(ctx, "check-1.issues");
    expect(result).toEqual({ found: true, value: [{ id: 1 }, { id: 2 }] });
  });
});

// ── CT-18: Empty string path ──────────────────────────────────────────────────

describe("lookupContextPath — CT-18 empty path", () => {
  test("returns found: false for an empty string path", () => {
    const ctx = { "step-1": { x: 1 } };
    const result = lookupContextPath(ctx, "");
    expect(result).toEqual({ found: false });
  });
});
