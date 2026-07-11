import { describe, expect, test } from "bun:test";
import { getTurnBudgetProof } from "./turn-budget-proof";

describe("getTurnBudgetProof (#862)", () => {
  test("returns the default 8/8 proof when guardrails is null", () => {
    expect(getTurnBudgetProof("turn_budget_exceeded", null)).toEqual({
      label: "Agent turns (per step)",
      value: "8 / 8",
    });
  });

  test("returns the configured value", () => {
    expect(
      getTurnBudgetProof("turn_budget_exceeded", { maxAgentTurnsPerStep: 12 }),
    ).toEqual({
      label: "Agent turns (per step)",
      value: "12 / 12",
    });
  });

  test("clamps to the ceiling of 32", () => {
    expect(
      getTurnBudgetProof("turn_budget_exceeded", {
        maxAgentTurnsPerStep: 500,
      }),
    ).toEqual({
      label: "Agent turns (per step)",
      value: "32 / 32",
    });
  });

  test("returns null for a different errorKind", () => {
    expect(
      getTurnBudgetProof("workflow_failed", { maxAgentTurnsPerStep: 12 }),
    ).toBeNull();
  });

  test("returns null when errorKind is null", () => {
    expect(getTurnBudgetProof(null, null)).toBeNull();
  });
});
