import { describe, expect, test } from "bun:test";
import { buildToolIconItems } from "./tool-icon-stack";

describe("buildToolIconItems", () => {
  test("returns empty array when no toolkits and no GitHub", () => {
    const items = buildToolIconItems({
      activeToolkits: [],
      githubConnected: false,
    });
    expect(items).toEqual([]);
  });

  test("shows GitHub native indicator when connected", () => {
    const items = buildToolIconItems({
      activeToolkits: [],
      githubConnected: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("github-native");
    expect(items[0].label).toBe("GitHub (native)");
  });

  test("deduplicates GitHub when both native and Composio", () => {
    const items = buildToolIconItems({
      activeToolkits: ["github"],
      githubConnected: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("github-native");
  });

  test("shows multiple toolkits with native GitHub", () => {
    const items = buildToolIconItems({
      activeToolkits: ["github", "jira"],
      githubConnected: true,
    });
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("github-native");
    expect(items[1].name).toBe("jira");
  });

  test("shows toolkits without native GitHub", () => {
    const items = buildToolIconItems({
      activeToolkits: ["jira", "linear"],
      githubConnected: false,
    });
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("jira");
    expect(items[1].name).toBe("linear");
  });
});
