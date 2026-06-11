/**
 * Agent Loops — condition evaluation unit tests (TDD RED)
 *
 * evaluateCondition op matrix:
 *   CO-01  eq — equal primitives → true
 *   CO-02  eq — unequal primitives → false
 *   CO-03  eq — type mismatch (string vs number) → condition_type_mismatch
 *   CO-04  neq — unequal → true
 *   CO-05  neq — equal → false
 *   CO-06  neq — type mismatch → condition_type_mismatch
 *   CO-07  gt — number > value → true
 *   CO-08  gt — number <= value → false
 *   CO-09  gt — string vs number → condition_type_mismatch
 *   CO-10  gt — both strings → condition_type_mismatch
 *   CO-11  gte — equal → true
 *   CO-12  gte — greater → true
 *   CO-13  gte — less → false
 *   CO-14  gte — non-numbers → condition_type_mismatch
 *   CO-15  lt — number < value → true
 *   CO-16  lt — number >= value → false
 *   CO-17  lt — non-numbers → condition_type_mismatch
 *   CO-18  lte — equal → true
 *   CO-19  lte — less → true
 *   CO-20  lte — greater → false
 *   CO-21  lte — non-numbers → condition_type_mismatch
 *   CO-22  exists — key present with value → true
 *   CO-23  exists — key absent → condition_path_missing
 *   CO-24  exists — key present, value is null → true (null IS a value)
 *   CO-25  contains — string includes substring → true
 *   CO-26  contains — string does not include substring → false
 *   CO-27  contains — array includes value → true
 *   CO-28  contains — array does not include value → false
 *   CO-29  contains — number type → condition_type_mismatch
 *   CO-30  contains — object type → condition_type_mismatch
 *   CO-31  missing path on any op → condition_path_missing (not silent false)
 *   CO-32  eq with boolean values → exact comparison
 */

import { describe, expect, test } from "bun:test";
import { evaluateCondition } from "./condition";
import type { Condition } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ctx(path: string, value: unknown): Record<string, unknown> {
  // Supports single-segment paths like "step-1.count" or "check-1.openIssueCount"
  const parts = path.split(".");
  if (parts.length === 1) {
    return { [path]: value };
  }
  // Two-segment: top.sub
  const [top, ...rest] = parts;
  return { [top]: { [rest.join(".")]: value } };
}

function cond(path: string, op: Condition["op"], value?: unknown): Condition {
  return value !== undefined ? { path, op, value } : { path, op };
}

// ── CO-01 / CO-02: eq happy path ──────────────────────────────────────────────

describe("evaluateCondition — CO-01 eq equal", () => {
  test("eq returns ok:true result:true for equal numbers", () => {
    const result = evaluateCondition(cond("step.count", "eq", 5), { step: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });

  test("eq returns ok:true result:true for equal strings", () => {
    const result = evaluateCondition(cond("step.status", "eq", "done"), {
      step: { status: "done" },
    });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-02 eq unequal", () => {
  test("eq returns ok:true result:false for unequal numbers", () => {
    const result = evaluateCondition(cond("step.count", "eq", 5), { step: { count: 3 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

// ── CO-03: eq type mismatch ────────────────────────────────────────────────────

describe("evaluateCondition — CO-03 eq type mismatch", () => {
  test("eq returns condition_type_mismatch when context value is string and condition value is number", () => {
    const result = evaluateCondition(cond("step.count", "eq", 5), { step: { count: "5" } });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-04 / CO-05 / CO-06: neq ────────────────────────────────────────────────

describe("evaluateCondition — CO-04 neq unequal", () => {
  test("neq returns ok:true result:true when values differ", () => {
    const result = evaluateCondition(cond("step.count", "neq", 5), { step: { count: 3 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-05 neq equal", () => {
  test("neq returns ok:true result:false when values are equal", () => {
    const result = evaluateCondition(cond("step.count", "neq", 5), { step: { count: 5 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

describe("evaluateCondition — CO-06 neq type mismatch", () => {
  test("neq returns condition_type_mismatch when types differ", () => {
    const result = evaluateCondition(cond("step.count", "neq", 5), {
      step: { count: "five" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-07 / CO-08 / CO-09 / CO-10: gt ────────────────────────────────────────

describe("evaluateCondition — CO-07 gt number greater", () => {
  test("gt returns ok:true result:true when context number > condition value", () => {
    const result = evaluateCondition(cond("check.count", "gt", 0), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-08 gt number not greater", () => {
  test("gt returns ok:true result:false when context number <= condition value", () => {
    const result = evaluateCondition(cond("check.count", "gt", 5), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

describe("evaluateCondition — CO-09 gt string context type mismatch", () => {
  test("gt returns condition_type_mismatch when context value is a string", () => {
    const result = evaluateCondition(cond("check.count", "gt", 0), {
      check: { count: "five" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

describe("evaluateCondition — CO-10 gt both strings type mismatch", () => {
  test("gt returns condition_type_mismatch when both values are strings", () => {
    const result = evaluateCondition(cond("check.status", "gt", "b"), {
      check: { status: "a" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-11 / CO-12 / CO-13 / CO-14: gte ───────────────────────────────────────

describe("evaluateCondition — CO-11 gte equal", () => {
  test("gte returns ok:true result:true when equal", () => {
    const result = evaluateCondition(cond("check.count", "gte", 5), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-12 gte greater", () => {
  test("gte returns ok:true result:true when greater", () => {
    const result = evaluateCondition(cond("check.count", "gte", 3), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-13 gte less", () => {
  test("gte returns ok:true result:false when less", () => {
    const result = evaluateCondition(cond("check.count", "gte", 10), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

describe("evaluateCondition — CO-14 gte non-numbers", () => {
  test("gte returns condition_type_mismatch for non-number context value", () => {
    const result = evaluateCondition(cond("check.count", "gte", 5), {
      check: { count: "five" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-15 / CO-16 / CO-17: lt ────────────────────────────────────────────────

describe("evaluateCondition — CO-15 lt less", () => {
  test("lt returns ok:true result:true when context number < condition value", () => {
    const result = evaluateCondition(cond("check.count", "lt", 10), { check: { count: 3 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-16 lt not less", () => {
  test("lt returns ok:true result:false when context number >= condition value", () => {
    const result = evaluateCondition(cond("check.count", "lt", 3), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

describe("evaluateCondition — CO-17 lt non-numbers", () => {
  test("lt returns condition_type_mismatch for non-number context value", () => {
    const result = evaluateCondition(cond("check.count", "lt", 10), {
      check: { count: "low" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-18 / CO-19 / CO-20 / CO-21: lte ──────────────────────────────────────

describe("evaluateCondition — CO-18 lte equal", () => {
  test("lte returns ok:true result:true when equal", () => {
    const result = evaluateCondition(cond("check.count", "lte", 5), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-19 lte less", () => {
  test("lte returns ok:true result:true when less", () => {
    const result = evaluateCondition(cond("check.count", "lte", 10), { check: { count: 3 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-20 lte greater", () => {
  test("lte returns ok:true result:false when greater", () => {
    const result = evaluateCondition(cond("check.count", "lte", 3), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: false });
  });
});

describe("evaluateCondition — CO-21 lte non-numbers", () => {
  test("lte returns condition_type_mismatch for non-number context value", () => {
    const result = evaluateCondition(cond("check.count", "lte", 5), {
      check: { count: "five" },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-22 / CO-23 / CO-24: exists ────────────────────────────────────────────

describe("evaluateCondition — CO-22 exists present", () => {
  test("exists returns ok:true result:true when path is found", () => {
    const result = evaluateCondition(cond("check.count", "exists"), { check: { count: 5 } });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-23 exists missing path", () => {
  test("exists returns condition_path_missing when path is not found", () => {
    const result = evaluateCondition(cond("check.count", "exists"), {});
    expect(result).toEqual({ ok: false, errorKind: "condition_path_missing" });
  });
});

describe("evaluateCondition — CO-24 exists null value", () => {
  test("exists returns ok:true result:true when path points to null", () => {
    const result = evaluateCondition(cond("check.value", "exists"), {
      check: { value: null },
    });
    expect(result).toEqual({ ok: true, result: true });
  });
});

// ── CO-25 / CO-26: contains string ───────────────────────────────────────────

describe("evaluateCondition — CO-25 contains string includes", () => {
  test("contains returns ok:true result:true when string includes substring", () => {
    const result = evaluateCondition(cond("step.message", "contains", "hello"), {
      step: { message: "say hello world" },
    });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-26 contains string not included", () => {
  test("contains returns ok:true result:false when string does not include substring", () => {
    const result = evaluateCondition(cond("step.message", "contains", "goodbye"), {
      step: { message: "say hello world" },
    });
    expect(result).toEqual({ ok: true, result: false });
  });
});

// ── CO-27 / CO-28: contains array ────────────────────────────────────────────

describe("evaluateCondition — CO-27 contains array includes value", () => {
  test("contains returns ok:true result:true when array includes the value", () => {
    const result = evaluateCondition(cond("check.labels", "contains", "bug"), {
      check: { labels: ["bug", "enhancement"] },
    });
    expect(result).toEqual({ ok: true, result: true });
  });
});

describe("evaluateCondition — CO-28 contains array does not include value", () => {
  test("contains returns ok:true result:false when array does not include the value", () => {
    const result = evaluateCondition(cond("check.labels", "contains", "critical"), {
      check: { labels: ["bug", "enhancement"] },
    });
    expect(result).toEqual({ ok: true, result: false });
  });
});

// ── CO-29: contains number → type mismatch ───────────────────────────────────

describe("evaluateCondition — CO-29 contains number type mismatch", () => {
  test("contains returns condition_type_mismatch when context value is a number", () => {
    const result = evaluateCondition(cond("check.count", "contains", "5"), {
      check: { count: 5 },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-30: contains object → type mismatch ───────────────────────────────────

describe("evaluateCondition — CO-30 contains object type mismatch", () => {
  test("contains returns condition_type_mismatch when context value is a plain object", () => {
    const result = evaluateCondition(cond("check.data", "contains", "x"), {
      check: { data: { key: "value" } },
    });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});

// ── CO-31: missing path on any op → condition_path_missing ───────────────────

describe("evaluateCondition — CO-31 missing path (not silent false)", () => {
  const ops: Array<Condition["op"]> = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"];

  for (const op of ops) {
    test(`${op} returns condition_path_missing when path is absent from context`, () => {
      const result = evaluateCondition(cond("missing.path", op, 42), {});
      expect(result).toEqual({ ok: false, errorKind: "condition_path_missing" });
    });
  }
});

// ── CO-32: eq with booleans ────────────────────────────────────────────────────

describe("evaluateCondition — CO-32 eq boolean", () => {
  test("eq returns ok:true result:true for equal boolean values", () => {
    const result = evaluateCondition(cond("step.done", "eq", true), { step: { done: true } });
    expect(result).toEqual({ ok: true, result: true });
  });

  test("eq returns ok:true result:false for unequal boolean values", () => {
    const result = evaluateCondition(cond("step.done", "eq", true), { step: { done: false } });
    expect(result).toEqual({ ok: true, result: false });
  });

  test("eq returns condition_type_mismatch when boolean context vs number condition", () => {
    const result = evaluateCondition(cond("step.done", "eq", 1), { step: { done: true } });
    expect(result).toEqual({ ok: false, errorKind: "condition_type_mismatch" });
  });
});
