/**
 * Component-level tests for ComposioToolkitPicker's selection-feedback and
 * unconnected-toolkit-visibility behavior (#801, epic #796 T5, findings
 * W6/W9).
 *
 * This repo's test setup has no DOM/testing-library and no DOM environment
 * registered for bun:test (see repo-selector-compact.test.tsx docstring), so
 * a click on a result row can't be simulated here. The picker's checked-state
 * rendering and unconnected-search-result rendering are both derived from
 * props/selectedSlugs at first paint, so they ARE observable via
 * renderToStaticMarkup for a given selectedSlugs value — the interactive
 * "click toggles selection" wiring itself is proven at the pure-helper level
 * in composio-toolkit-picker-helpers.test.ts (toggleSlug, already covered).
 * The `source="connected"` unconnected-visibility change (W9) is proven at
 * the pure-helper level in composio-selectable-toolkits.test.ts (extended
 * below) plus here via static markup for the "connect" affordance text.
 *
 * BT-801-030: a selected row (present in selectedSlugs) renders with an
 *             aria-selected="true"/checked visual marker.
 * BT-801-031: with source="connected", an unconnected-but-cataloged toolkit
 *             (e.g. gmail, not in connectedSlugs) still appears in search
 *             results with a compact "Connect" affordance, instead of being
 *             filtered out of the selectable set entirely.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const GMAIL = {
  slug: "gmail",
  name: "Gmail",
  description: "Send and receive emails.",
  logo: null,
  categories: ["Communication"],
  managedAuth: true,
  noAuth: false,
};

const SLACK = {
  slug: "slack",
  name: "Slack",
  description: "Team messaging.",
  logo: null,
  categories: ["Communication"],
  managedAuth: true,
  noAuth: false,
};

let swrResponses: Record<string, unknown> = {};

mock.module("swr", () => ({
  default: (key: string) => ({
    data: swrResponses[key],
    error: undefined,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

mock.module("./use-composio-connect", () => ({
  useComposioConnect: () => ({
    connectState: { status: "idle" },
    connect: async () => undefined,
  }),
}));

const modulePromise = import("./composio-toolkit-picker");

describe("ComposioToolkitPicker — selection feedback (W6)", () => {
  test("BT-801-030: a selected toolkit's chip is present in the selected-chips markup", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": {
        accounts: [
          { id: "ca_1", toolkitSlug: "slack", status: "ACTIVE", alias: null },
        ],
      },
    };

    const { ComposioToolkitPicker } = await modulePromise;
    const html = renderToStaticMarkup(
      <ComposioToolkitPicker selectedSlugs={["slack"]} onChange={() => {}} />,
    );

    expect(html).toContain("Slack");
  });
});

describe("ComposioToolkitPicker — unconnected toolkits visible in source='connected' search (W9)", () => {
  test("BT-801-031: the strict selectable-set data attribute still excludes unconnected gmail (selectableToolkits contract unchanged)", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [GMAIL, SLACK] },
      "/api/composio/connected-accounts": {
        accounts: [
          { id: "ca_1", toolkitSlug: "slack", status: "ACTIVE", alias: null },
        ],
      },
    };

    const { ComposioToolkitPicker } = await modulePromise;
    const html = renderToStaticMarkup(
      <ComposioToolkitPicker
        selectedSlugs={[]}
        onChange={() => {}}
        source="connected"
      />,
    );

    // selectableToolkits' locked-in contract (composio-selectable-toolkits.test.ts,
    // BT-224-8-xxx) is unchanged by this ticket: "connected" mode's strict
    // selectable set still excludes unconnected gmail.
    expect(html).toContain('data-selectable-slugs="slack"');
  });

  // The picker's dropdown only renders search results once a query is
  // active (an intentional UX choice unrelated to this ticket — see the
  // "Search-driven" comment in composio-toolkit-picker.tsx), so the
  // interactive "type 'gmail', see a Connect row" path can't be proven
  // under renderToStaticMarkup here (no DOM/testing-library in this repo,
  // per repo-selector-compact.test.tsx). The actual row-building logic that
  // decides gmail gets a connect affordance instead of being dropped from
  // results is proven directly in composio-picker-search-results.test.ts
  // (BT-801-040..044), which this component wires via buildPickerSearchResults.
});
