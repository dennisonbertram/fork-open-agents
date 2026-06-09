/**
 * Regression tests for shouldAutoExpandOrgs.
 *
 * These tests catch future breakage if the auto-expand logic is reverted,
 * weakened, or accidentally inverted. Each scenario covers a distinct
 * boundary condition.
 */
import { describe, expect, test } from "bun:test";
import { shouldAutoExpandOrgs } from "./accounts-helpers";

describe("shouldAutoExpandOrgs — regression coverage", () => {
  test("one account missing out of two expands the list", () => {
    // Most common partial-install scenario: personal + one org, personal not yet installed.
    expect(shouldAutoExpandOrgs(1, 2)).toBe(true);
  });

  test("all-installed single account stays collapsed", () => {
    // Regression: happy-path must NOT force the list open.
    expect(shouldAutoExpandOrgs(1, 1)).toBe(false);
  });

  test("no-account edge case stays collapsed and does not throw", () => {
    // Regression: guard against divide-by-zero or incorrect truthy return.
    expect(shouldAutoExpandOrgs(0, 0)).toBe(false);
  });

  test("all accounts missing (0 installed, 4 total) expands", () => {
    // Ensures the helper works for large org lists where no install exists.
    expect(shouldAutoExpandOrgs(0, 4)).toBe(true);
  });
});
