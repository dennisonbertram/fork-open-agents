import { describe, expect, test } from "bun:test";
import {
  commitChangesRequestSchema,
  createBranchRequestSchema,
  deploymentUrlQuerySchema,
  discardChangesRequestSchema,
  mergePrRequestSchema,
  openPullRequestRequestSchema,
} from "./http-schemas";

describe("createBranchRequestSchema", () => {
  test("accepts a valid body", () => {
    const r = createBranchRequestSchema.safeParse({
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "feature/x",
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing base/branch", () => {
    expect(
      createBranchRequestSchema.safeParse({ sessionTitle: "x" }).success,
    ).toBe(false);
    expect(
      createBranchRequestSchema.safeParse({
        sessionTitle: "x",
        baseBranch: "",
        branchName: "y",
      }).success,
    ).toBe(false);
  });
});

describe("discardChangesRequestSchema", () => {
  test("allows empty body and optional paths", () => {
    expect(discardChangesRequestSchema.safeParse({}).success).toBe(true);
    expect(
      discardChangesRequestSchema.safeParse({ filePath: "a.ts" }).success,
    ).toBe(true);
  });
});

describe("commitChangesRequestSchema", () => {
  test("requires base/branch, allows optional commit message fields", () => {
    const r = commitChangesRequestSchema.safeParse({
      sessionTitle: "s",
      baseBranch: "main",
      branchName: "feat/x",
      commitTitle: "feat: x",
    });
    expect(r.success).toBe(true);
    expect(
      commitChangesRequestSchema.safeParse({ sessionTitle: "s" }).success,
    ).toBe(false);
  });
});

describe("openPullRequestRequestSchema", () => {
  test("requires repoUrl/title/baseBranch; optional flags", () => {
    const r = openPullRequestRequestSchema.safeParse({
      repoUrl: "https://github.com/o/r",
      title: "My PR",
      baseBranch: "main",
      isDraft: true,
      shouldAutoMerge: false,
    });
    expect(r.success).toBe(true);
    expect(
      openPullRequestRequestSchema.safeParse({ title: "no repo" }).success,
    ).toBe(false);
  });
});

describe("mergePrRequestSchema", () => {
  test("allows empty body", () => {
    expect(mergePrRequestSchema.safeParse({}).success).toBe(true);
  });
  test("accepts valid merge methods, rejects invalid", () => {
    expect(
      mergePrRequestSchema.safeParse({ mergeMethod: "squash" }).success,
    ).toBe(true);
    expect(
      mergePrRequestSchema.safeParse({ mergeMethod: "rebase" }).success,
    ).toBe(true);
    expect(
      mergePrRequestSchema.safeParse({ mergeMethod: "fast-forward" }).success,
    ).toBe(false);
  });
});

describe("deploymentUrlQuerySchema", () => {
  test("coerces prNumber from a query string", () => {
    const r = deploymentUrlQuerySchema.safeParse({ prNumber: "42" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.prNumber).toBe(42);
    }
  });
  test("rejects a non-numeric prNumber", () => {
    expect(
      deploymentUrlQuerySchema.safeParse({ prNumber: "abc" }).success,
    ).toBe(false);
  });
  test("allows an empty query", () => {
    expect(deploymentUrlQuerySchema.safeParse({}).success).toBe(true);
  });
});
