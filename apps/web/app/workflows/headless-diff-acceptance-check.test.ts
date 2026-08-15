import { describe, expect, test } from "bun:test";
import { checkDiffAcceptance } from "./headless-diff-acceptance-check";

/**
 * #1288: the acceptance check — when a caller declares which files a run may
 * change, this compares the run's ACTUAL changed paths against that list and
 * names any offender. Pure and workflow-safe: no sandbox, no DB, just a set
 * comparison, so it is trivially unit-testable apart from the sandbox probe
 * that supplies `changedPaths`.
 */
describe("checkDiffAcceptance (#1288)", () => {
  test("no violation when every changed path is in the declared list", () => {
    const result = checkDiffAcceptance(
      ["src/a.ts", "src/b.ts"],
      ["src/a.ts", "src/b.ts", "src/c.ts"],
    );
    expect(result).toEqual({ violated: false });
  });

  test("no violation when nothing changed", () => {
    const result = checkDiffAcceptance([], ["src/a.ts"]);
    expect(result).toEqual({ violated: false });
  });

  test("reports a violation naming every offending path", () => {
    const result = checkDiffAcceptance(
      ["src/a.ts", "unexpected.ts", "also-unexpected.ts"],
      ["src/a.ts"],
    );
    expect(result).toEqual({
      violated: true,
      offendingPaths: ["unexpected.ts", "also-unexpected.ts"],
    });
  });

  test("an empty declared list means any changed file is a violation", () => {
    const result = checkDiffAcceptance(["src/a.ts"], []);
    expect(result).toEqual({
      violated: true,
      offendingPaths: ["src/a.ts"],
    });
  });
});
