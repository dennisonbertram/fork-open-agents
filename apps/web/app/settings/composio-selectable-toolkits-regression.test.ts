/**
 * Regression tests for selectableToolkits.
 * These would fail if the implementation in 6f2e661a were reverted.
 */
import { describe, expect, test } from "bun:test";
import { selectableToolkits } from "./composio-selectable-toolkits";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

const FULL_CATALOG: ComposioToolkitSummary[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Email.",
    logo: null,
    categories: [],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Chat.",
    logo: null,
    categories: [],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "github",
    name: "GitHub",
    description: "Code.",
    logo: null,
    categories: [],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "shellexec",
    name: "Shell",
    description: "Run shell commands.",
    logo: null,
    categories: [],
    managedAuth: false,
    noAuth: true,
  },
];

// Regression: switching source from "connected" to "all" must expose the full catalog.
// If source branching were removed, "all" would behave like "connected".
describe("regression: source=all always returns full catalog", () => {
  test("all source with 0 connected slugs returns all 4 catalog entries", () => {
    const result = selectableToolkits({
      catalog: FULL_CATALOG,
      connectedSlugs: new Set(),
      source: "all",
    });
    expect(result).toHaveLength(4);
  });

  test("all source with 1 connected slug still returns all 4 entries", () => {
    const result = selectableToolkits({
      catalog: FULL_CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "all",
    });
    expect(result).toHaveLength(4);
  });
});

// Regression: connected mode must not expose unconnected, non-noAuth toolkits.
// If the filter were removed, unconnected tools would leak into the picker.
describe("regression: connected source never includes unconnected non-noAuth toolkits", () => {
  test("slack and github are hidden when only gmail is connected", () => {
    const result = selectableToolkits({
      catalog: FULL_CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    expect(slugs).not.toContain("slack");
    expect(slugs).not.toContain("github");
  });

  test("noAuth toolkit shellexec is always present in connected mode", () => {
    const result = selectableToolkits({
      catalog: FULL_CATALOG,
      connectedSlugs: new Set(), // nothing connected
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("shellexec");
  });
});

// Regression: catalog order must be preserved in the result.
// If the implementation used a different iteration strategy, order could change.
describe("regression: catalog order preserved in connected mode", () => {
  test("result preserves the catalog order for connected + noAuth toolkits", () => {
    // gmail (index 0) + shellexec (index 3); result should be [gmail, shellexec]
    const result = selectableToolkits({
      catalog: FULL_CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    expect(slugs.indexOf("gmail")).toBeLessThan(slugs.indexOf("shellexec"));
  });
});

// Regression: pure function — must not mutate the input catalog array.
describe("regression: selectableToolkits does not mutate catalog", () => {
  test("catalog array is unchanged after calling selectableToolkits", () => {
    const catalog = [...FULL_CATALOG];
    const lengthBefore = catalog.length;
    selectableToolkits({
      catalog,
      connectedSlugs: new Set(["gmail"]),
      source: "connected",
    });
    expect(catalog).toHaveLength(lengthBefore);
  });
});
