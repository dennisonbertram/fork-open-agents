/**
 * BT-224-8: Tests for the selectableToolkits pure helper function.
 *
 * Behavioral contracts:
 * - BT-224-8-001: "connected" source returns only toolkits that are connected OR noAuth
 * - BT-224-8-002: "all" source returns the full catalog regardless of connection state
 * - BT-224-8-003: "connected" source deduplicates when a noAuth toolkit is also connected
 * - BT-224-8-004: "connected" with no connected slugs and no noAuth toolkits returns empty array
 * - BT-224-8-005: "all" source with empty connectedSlugs returns full catalog
 * - BT-224-8-006: source defaults to "connected" when omitted
 * - BT-224-8-007: connected slug not found in catalog does NOT appear in selectable set (it's unknown/legacy)
 *
 * These tests FAIL until selectableToolkits is exported from
 * apps/web/app/settings/composio-selectable-toolkits.ts.
 */
import { describe, expect, test } from "bun:test";
import { selectableToolkits } from "./composio-selectable-toolkits";
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

const CATALOG: ComposioToolkitSummary[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Send and receive emails.",
    logo: "https://logos.composio.dev/gmail.png",
    categories: ["Communication"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Team messaging.",
    logo: "https://logos.composio.dev/slack.png",
    categories: ["Communication"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "linear",
    name: "Linear",
    description: "Issue tracking.",
    logo: null,
    categories: ["Productivity"],
    managedAuth: true,
    noAuth: false,
  },
  {
    slug: "codeinterpreter",
    name: "Code Interpreter",
    description: "Run code in a sandbox.",
    logo: null,
    categories: ["Utilities"],
    managedAuth: false,
    noAuth: true,
  },
  {
    slug: "browser",
    name: "Browser",
    description: "Browse the web.",
    logo: null,
    categories: ["Utilities"],
    managedAuth: false,
    noAuth: true,
  },
];

describe("BT-224-8-001: connected source returns only connected + noAuth toolkits", () => {
  test("returns only gmail (connected) + noAuth toolkits when only gmail is connected", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("gmail");
    expect(slugs).toContain("codeinterpreter");
    expect(slugs).toContain("browser");
    expect(slugs).not.toContain("slack");
    expect(slugs).not.toContain("linear");
  });

  test("returns multiple connected toolkits + noAuth toolkits", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail", "slack"]),
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("gmail");
    expect(slugs).toContain("slack");
    expect(slugs).toContain("codeinterpreter");
    expect(slugs).toContain("browser");
    expect(slugs).not.toContain("linear");
  });
});

describe("BT-224-8-002: all source returns full catalog", () => {
  test("returns all 5 catalog entries regardless of connected slugs", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "all",
    });
    expect(result).toHaveLength(5);
    const slugs = result.map((t) => t.slug);
    expect(slugs).toContain("gmail");
    expect(slugs).toContain("slack");
    expect(slugs).toContain("linear");
    expect(slugs).toContain("codeinterpreter");
    expect(slugs).toContain("browser");
  });

  test("all source with empty connectedSlugs returns full catalog", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "all",
    });
    expect(result).toHaveLength(5);
  });
});

describe("BT-224-8-003: no duplicates when noAuth toolkit is also in connectedSlugs", () => {
  test("codeinterpreter appears exactly once even if it is in both noAuth and connectedSlugs", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail", "codeinterpreter"]),
      source: "connected",
    });
    const codeinterpreterEntries = result.filter(
      (t) => t.slug === "codeinterpreter",
    );
    expect(codeinterpreterEntries).toHaveLength(1);
  });
});

describe("BT-224-8-004: connected source with nothing connected and no noAuth returns empty", () => {
  const catalogNoNoAuth: ComposioToolkitSummary[] = [
    {
      slug: "gmail",
      name: "Gmail",
      description: null,
      logo: null,
      categories: [],
      managedAuth: true,
      noAuth: false,
    },
    {
      slug: "slack",
      name: "Slack",
      description: null,
      logo: null,
      categories: [],
      managedAuth: true,
      noAuth: false,
    },
  ];

  test("returns empty array when nothing is connected and no noAuth toolkits exist", () => {
    const result = selectableToolkits({
      catalog: catalogNoNoAuth,
      connectedSlugs: new Set(),
      source: "connected",
    });
    expect(result).toHaveLength(0);
  });
});

describe("BT-224-8-005: all source with empty connectedSlugs returns full catalog", () => {
  test("returns all catalog entries even with empty connectedSlugs", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "all",
    });
    expect(result).toHaveLength(CATALOG.length);
  });
});

describe("BT-224-8-006: source defaults to connected when omitted", () => {
  test("omitting source behaves identically to source=connected", () => {
    const withDefault = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail"]),
    });
    const withExplicit = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["gmail"]),
      source: "connected",
    });
    expect(withDefault.map((t) => t.slug).sort()).toEqual(
      withExplicit.map((t) => t.slug).sort(),
    );
  });
});

describe("BT-224-8-007: connected slug not in catalog does not appear in selectable set", () => {
  test("legacy typo slug webseerch is not returned by selectableToolkits", () => {
    const result = selectableToolkits({
      catalog: CATALOG,
      connectedSlugs: new Set(["webseerch", "gmail"]),
      source: "connected",
    });
    const slugs = result.map((t) => t.slug);
    // webseerch isn't in the catalog so selectableToolkits must not return it
    expect(slugs).not.toContain("webseerch");
    // gmail IS in the catalog and connected, so it appears
    expect(slugs).toContain("gmail");
  });
});
