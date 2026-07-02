/**
 * run-completion-label.test.ts (#767)
 *
 * A completed run with >=1 failed step must read "Completed — N step(s)
 * failed" (amber), never a clean green "Completed" — used by the runs list
 * row and the run-detail header.
 */

import { describe, expect, it } from "bun:test";
import { getRunCompletionLabel } from "./run-completion-label";

describe("getRunCompletionLabel", () => {
  it("returns null for a non-completed run regardless of failedStepCount", () => {
    expect(
      getRunCompletionLabel({ status: "running", failedStepCount: 3 }),
    ).toBeNull();
  });

  it("returns null for a completed run with zero failed steps", () => {
    expect(
      getRunCompletionLabel({ status: "completed", failedStepCount: 0 }),
    ).toBeNull();
  });

  it("returns a singular label for exactly one failed step", () => {
    expect(
      getRunCompletionLabel({ status: "completed", failedStepCount: 1 }),
    ).toBe("Completed — 1 step failed");
  });

  it("returns a plural label for multiple failed steps", () => {
    expect(
      getRunCompletionLabel({ status: "completed", failedStepCount: 3 }),
    ).toBe("Completed — 3 steps failed");
  });
});
