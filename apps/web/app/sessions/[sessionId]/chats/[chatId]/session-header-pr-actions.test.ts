import { describe, expect, test } from "bun:test";
import { selectPrAction } from "./session-header-pr-actions";

describe("selectPrAction", () => {
  test("Create PR is the default when there is no PR", () => {
    expect(selectPrAction({ hasExistingPr: false, prStatus: null })).toBe(
      "create",
    );
  });

  test("Create PR is the default after a PR is merged or closed", () => {
    for (const prStatus of ["merged", "closed"] as const) {
      expect(selectPrAction({ hasExistingPr: true, prStatus })).toBe("create");
    }
  });

  test("Merge PR once a PR is open and mergeable", () => {
    expect(
      selectPrAction({
        hasExistingPr: true,
        prStatus: "open",
        mergeReadinessReasons: ["Required checks are still running"],
      }),
    ).toBe("merge");
  });

  test("Resolve Conflicts when the open PR has merge conflicts", () => {
    expect(
      selectPrAction({
        hasExistingPr: true,
        prStatus: "open",
        mergeReadinessReasons: ["Pull request has merge conflicts"],
      }),
    ).toBe("resolve");
  });

  test("defaults an open PR to Merge before readiness loads", () => {
    expect(selectPrAction({ hasExistingPr: true, prStatus: "open" })).toBe(
      "merge",
    );
  });
});
