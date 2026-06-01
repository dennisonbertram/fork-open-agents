/**
 * Tests for goal-validation.ts — pure validation service.
 *
 * BT-038-001: complete + requireEvidence:true + evidence present → ok
 * BT-038-002: complete + requireEvidence:true + evidence empty → missing_required_evidence
 * BT-038-003: complete + requireEvidence:false + evidence empty → ok (dormant)
 * BT-038-004: failed/canceled/blocked (any evidence) → ok
 */

import { describe, expect, test } from "bun:test";

import {
  validateGoalCompletion,
  type GoalValidationResult,
} from "./goal-validation";

describe("validateGoalCompletion", () => {
  // BT-038-001
  test("BT-038-001: complete + requireEvidence:true + evidence present → ok", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "complete",
      evidenceRefs: ["ref-abc"],
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });

  // BT-038-002
  test("BT-038-002: complete + requireEvidence:true + evidence empty → missing_required_evidence", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "complete",
      evidenceRefs: [],
      requireEvidence: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_required_evidence");
      expect(result.reason).toContain("evidence ref");
    }
  });

  // BT-038-003
  test("BT-038-003: complete + requireEvidence:false + evidence empty → ok (dormant path)", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "complete",
      evidenceRefs: [],
      requireEvidence: false,
    });

    expect(result.ok).toBe(true);
  });

  // BT-038-004a
  test("BT-038-004a: failed status with no evidence → ok", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "failed",
      evidenceRefs: [],
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });

  // BT-038-004b
  test("BT-038-004b: canceled status with no evidence → ok", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "canceled",
      evidenceRefs: [],
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });

  // BT-038-004c
  test("BT-038-004c: blocked status with no evidence → ok", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "blocked",
      evidenceRefs: [],
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });

  // BT-038-004d: multiple evidence refs still work when present
  test("BT-038-004d: complete + requireEvidence:true + multiple evidence refs → ok", () => {
    const result: GoalValidationResult = validateGoalCompletion({
      status: "complete",
      evidenceRefs: ["ref-1", "ref-2", "ref-3"],
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });

  // Edge: readonly array is accepted
  test("accepts readonly evidenceRefs array", () => {
    const refs = ["ref-a", "ref-b"] as const;
    const result: GoalValidationResult = validateGoalCompletion({
      status: "complete",
      evidenceRefs: refs,
      requireEvidence: true,
    });

    expect(result.ok).toBe(true);
  });
});
