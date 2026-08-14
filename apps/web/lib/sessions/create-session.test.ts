/**
 * Unit tests for resolveSessionBranches (#1251).
 *
 * Before this fix, createSessionCore's new-branch path called
 * generateBranchName() and never read input.branch at all — a session
 * created with isNewBranch: true and branch: "develop" was cloned from the
 * repository's default branch, not develop.
 *
 * BT-1251-01: isNewBranch true + a caller-supplied branch keeps it as the
 *   base while generating a different working branch name.
 * BT-1251-02: isNewBranch true + no caller branch falls back to the repo's
 *   default branch as the base (today's fallback chain, preserved).
 * BT-1251-03: isNewBranch true + no caller branch + no repo default base
 *   branch is null — no retroactive behavior invented for the fully-unset case.
 * BT-1251-04 (regression): isNewBranch false never sets a base branch,
 *   whatever `branch`/repo default resolve to.
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { resolveSessionBranches } = await import("./create-session");

describe("resolveSessionBranches", () => {
  test("BT-1251-01: keeps the caller's branch as the base while generating a distinct working branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: "develop",
      repoDefaultBranch: "main",
      username: "dennison",
      name: "Dennison",
    });

    expect(result.baseBranch).toBe("develop");
    expect(result.branch).not.toBe("develop");
    expect(result.branch).toBeTruthy();
  });

  test("BT-1251-02: falls back to the repo default branch as the base when the caller names none", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: undefined,
      repoDefaultBranch: "develop",
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBe("develop");
    expect(result.branch).not.toBe("develop");
  });

  test("BT-1251-03: base is null when neither the caller nor the repo settings name a branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: true,
      inputBranch: undefined,
      repoDefaultBranch: null,
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBeNull();
  });

  test("BT-1251-04 regression: isNewBranch false never sets a base branch", () => {
    const result = resolveSessionBranches({
      isNewBranch: false,
      inputBranch: "develop",
      repoDefaultBranch: "main",
      username: "dennison",
      name: undefined,
    });

    expect(result.baseBranch).toBeNull();
    expect(result.branch).toBe("develop");
  });
});
