import { describe, expect, test } from "bun:test";
import { getEffectiveRepoToolkitSlugs } from "./repo-toolkit-selection";

describe("getEffectiveRepoToolkitSlugs — GitHub default-on", () => {
  test("never configured (null) + GitHub connected → defaults to ['github']", () => {
    expect(
      getEffectiveRepoToolkitSlugs({
        selectedToolkitSlugs: null,
        githubConnected: true,
      }),
    ).toEqual(["github"]);
  });

  test("never configured (null) + GitHub NOT connected → empty", () => {
    expect(
      getEffectiveRepoToolkitSlugs({
        selectedToolkitSlugs: null,
        githubConnected: false,
      }),
    ).toEqual([]);
  });

  test("explicit selection wins as-is (can include github)", () => {
    expect(
      getEffectiveRepoToolkitSlugs({
        selectedToolkitSlugs: ["github", "linear"],
        githubConnected: true,
      }),
    ).toEqual(["github", "linear"]);
  });

  test("explicit empty selection means 'no tools' — default-on does NOT re-add github", () => {
    expect(
      getEffectiveRepoToolkitSlugs({
        selectedToolkitSlugs: [],
        githubConnected: true,
      }),
    ).toEqual([]);
  });

  test("explicit selection without github is respected (user removed it)", () => {
    expect(
      getEffectiveRepoToolkitSlugs({
        selectedToolkitSlugs: ["linear"],
        githubConnected: true,
      }),
    ).toEqual(["linear"]);
  });
});
