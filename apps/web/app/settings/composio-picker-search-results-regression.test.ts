/**
 * Regression tests for buildPickerSearchResults (#801, epic #796 T5, finding
 * W9 / #736 item 2). Would fail if the implementation from 64053972 were
 * reverted or if a future change reintroduced the pre-#801 dead-end (an
 * unconnected toolkit silently disappearing from "connected" mode's search
 * results instead of getting a Connect affordance).
 */
import { describe, expect, test } from "bun:test";
import { buildPickerSearchResults } from "./composio-picker-search-results";
import { selectableToolkits } from "./composio-selectable-toolkits";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

const GMAIL: ComposioToolkitSummary = {
  slug: "gmail",
  name: "Gmail",
  description: "Send and receive emails.",
  logo: null,
  categories: ["Communication"],
  managedAuth: true,
  noAuth: false,
};

const SLACK: ComposioToolkitSummary = {
  slug: "slack",
  name: "Slack",
  description: "Team messaging.",
  logo: null,
  categories: ["Communication"],
  managedAuth: true,
  noAuth: false,
};

const BROWSER: ComposioToolkitSummary = {
  slug: "browser",
  name: "Browser",
  description: "Browse the web.",
  logo: null,
  categories: ["Utilities"],
  managedAuth: false,
  noAuth: true,
};

const CATALOG = [GMAIL, SLACK, BROWSER];

describe("regression: unconnected toolkit never disappears from connected-mode search results", () => {
  test("gmail (unconnected) is present in results even though selectableToolkits would have excluded it entirely", () => {
    // This is the exact pre-#801 dead-end: selectableToolkits({source:
    // "connected"}) legitimately excludes gmail (it's the "already usable"
    // set contract, unchanged by this ticket) — but buildPickerSearchResults
    // must NOT reuse that same exclusion for search rendering, or the W9 fix
    // silently regresses back to "No tools matching 'gmail'".
    const strictSelectable = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
    });
    expect(strictSelectable.map((t) => t.slug)).not.toContain("gmail");

    const searchResults = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
      query: "gmail",
    });
    expect(searchResults.map((r) => r.slug)).toContain("gmail");
    expect(searchResults.find((r) => r.slug === "gmail")?.connectable).toBe(
      true,
    );
  });
});

describe("regression: noAuth toolkits are never marked connectable, even unconnected", () => {
  test("browser (noAuth, not in connectedSlugs) is connectable=false — it needs no connect step at all", () => {
    const searchResults = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "connected",
      query: "browser",
    });
    const browser = searchResults.find((r) => r.slug === "browser");
    expect(browser).toBeDefined();
    expect(browser?.connectable).toBe(false);
  });
});

describe("regression: 'all' mode search results are never tagged connectable, even for unconnected toolkits", () => {
  test("with source='all', every unconnected match still reports connectable=false across the whole catalog", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "all",
      query: "",
    });
    expect(results.every((r) => r.connectable === false)).toBe(true);
  });
});
