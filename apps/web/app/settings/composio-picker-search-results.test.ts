/**
 * Tests for buildPickerSearchResults (#801, epic #796 T5, finding W9 /
 * #736 item 2).
 *
 * Before this ticket, ComposioToolkitPicker's `source="connected"` mode
 * called `selectableToolkits(...)` (composio-selectable-toolkits.ts) to
 * decide BOTH what's selectable AND what appears in search results — so
 * searching an unconnected-but-real toolkit (e.g. "gmail" when only Slack is
 * connected) produced zero rows and the dead-end "No tools matching 'gmail'"
 * message, with no path to connect it (the exact issue named in #736 item 2
 * and this ticket's W9).
 *
 * `selectableToolkits` itself is intentionally left unchanged (its existing
 * BT-224-8-xxx contract is a locked-in regression suite used elsewhere) —
 * this ticket adds a NEW helper, `buildPickerSearchResults`, used only for
 * the picker's search-result rendering. It returns every catalog match
 * (not just the connected/noAuth subset) tagged with `connectable`, so the
 * picker can render a compact "Connect" affordance for matches that aren't
 * yet usable, instead of filtering them out of the results entirely.
 *
 * BT-801-040: source="connected", searching an unconnected cataloged slug
 *             (e.g. "gmail") returns a result row for it, tagged
 *             connectable=true.
 * BT-801-041: source="connected", a connected slug's result row is tagged
 *             connectable=false (it's already usable — no Connect affordance
 *             needed).
 * BT-801-042: source="connected", a noAuth toolkit's result row is tagged
 *             connectable=false (needs no connection at all).
 * BT-801-043: source="all" never tags anything connectable=true — "all" mode
 *             already shows the full catalog for direct selection, unrelated
 *             to this ticket's connected-mode dead-end fix.
 * BT-801-044: query filters the returned rows exactly like filterToolkits.
 */
import { describe, expect, test } from "bun:test";
import { buildPickerSearchResults } from "./composio-picker-search-results";
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

const CODE_INTERPRETER: ComposioToolkitSummary = {
  slug: "codeinterpreter",
  name: "Code Interpreter",
  description: "Run code in a sandbox.",
  logo: null,
  categories: ["Utilities"],
  managedAuth: false,
  noAuth: true,
};

const CATALOG = [GMAIL, SLACK, CODE_INTERPRETER];

describe("buildPickerSearchResults — connected mode surfaces unconnected matches (W9)", () => {
  test("BT-801-040: unconnected 'gmail' appears in results tagged connectable=true", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
      query: "gmail",
    });
    const gmail = results.find((r) => r.slug === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail?.connectable).toBe(true);
  });

  test("BT-801-041: connected 'slack' appears tagged connectable=false", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
      query: "slack",
    });
    const slack = results.find((r) => r.slug === "slack");
    expect(slack).toBeDefined();
    expect(slack?.connectable).toBe(false);
  });

  test("BT-801-042: noAuth toolkit appears tagged connectable=false", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "connected",
      query: "code",
    });
    const codeInterpreter = results.find((r) => r.slug === "codeinterpreter");
    expect(codeInterpreter).toBeDefined();
    expect(codeInterpreter?.connectable).toBe(false);
  });
});

describe("buildPickerSearchResults — 'all' mode never tags connectable", () => {
  test("BT-801-043: source='all' returns gmail tagged connectable=false even though unconnected", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(),
      source: "all",
      query: "gmail",
    });
    const gmail = results.find((r) => r.slug === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail?.connectable).toBe(false);
  });
});

describe("buildPickerSearchResults — query filtering", () => {
  test("BT-801-044: query filters non-matching entries out entirely", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
      query: "gmail",
    });
    expect(results.map((r) => r.slug)).toEqual(["gmail"]);
  });

  test("empty query returns every catalog entry", () => {
    const results = buildPickerSearchResults({
      catalog: CATALOG,
      connectedSlugs: new Set(["slack"]),
      source: "connected",
      query: "",
    });
    expect(results).toHaveLength(3);
  });
});
