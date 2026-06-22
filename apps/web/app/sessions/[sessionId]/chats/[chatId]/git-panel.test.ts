import { describe, expect, test } from "bun:test";
import { getPullRequestCreationNotice } from "./git-panel-copy";

describe("getPullRequestCreationNotice", () => {
  test("names the source branch, base branch, and generated details behavior", () => {
    expect(
      getPullRequestCreationNotice({
        branchName: "d/example",
        baseBranch: "main",
        willAutoGenerateTitle: true,
      }),
    ).toBe(
      "Creates a GitHub pull request from d/example into main. The title and description will be generated first.",
    );
  });

  test("describes when provided title and description will be used", () => {
    expect(
      getPullRequestCreationNotice({
        branchName: "feature/manual-copy",
        baseBranch: "develop",
        willAutoGenerateTitle: false,
      }),
    ).toBe(
      "Creates a GitHub pull request from feature/manual-copy into develop. The title and description above will be used.",
    );
  });
});
