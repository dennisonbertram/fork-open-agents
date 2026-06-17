import { describe, expect, test } from "bun:test";
import { selectPrAction } from "./session-header-pr-actions";

describe("selectPrAction", () => {
  test("returns null for a chat-only (no repo) session", () => {
    expect(
      selectPrAction({
        hasRepo: false,
        hasExistingPr: false,
        prStatus: null,
        hasChanges: true,
      }),
    ).toBeNull();
  });

  test("Create PR when there are changes and no PR yet", () => {
    expect(
      selectPrAction({
        hasRepo: true,
        hasExistingPr: false,
        prStatus: null,
        hasChanges: true,
      }),
    ).toBe("create");
  });

  test("nothing when no PR and no changes", () => {
    expect(
      selectPrAction({
        hasRepo: true,
        hasExistingPr: false,
        prStatus: null,
        hasChanges: false,
      }),
    ).toBeNull();
  });

  test("Merge PR when an open PR is mergeable (no conflict reasons)", () => {
    expect(
      selectPrAction({
        hasRepo: true,
        hasExistingPr: true,
        prStatus: "open",
        hasChanges: false,
        mergeReadinessReasons: ["Required checks are still running"],
      }),
    ).toBe("merge");
  });

  test("Resolve Conflicts when an open PR reports merge conflicts", () => {
    expect(
      selectPrAction({
        hasRepo: true,
        hasExistingPr: true,
        prStatus: "open",
        hasChanges: false,
        mergeReadinessReasons: ["Pull request has merge conflicts"],
      }),
    ).toBe("resolve");
  });

  test("nothing once the PR is merged or closed", () => {
    for (const prStatus of ["merged", "closed"] as const) {
      expect(
        selectPrAction({
          hasRepo: true,
          hasExistingPr: true,
          prStatus,
          hasChanges: false,
        }),
      ).toBeNull();
    }
  });

  test("defaults an open PR to Merge when readiness hasn't loaded yet", () => {
    expect(
      selectPrAction({
        hasRepo: true,
        hasExistingPr: true,
        prStatus: "open",
        hasChanges: false,
      }),
    ).toBe("merge");
  });
});
