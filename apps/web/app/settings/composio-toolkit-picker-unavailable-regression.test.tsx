/**
 * Regression: a FAILED /api/composio/connected-accounts fetch must not be
 * rendered as "not connected" (#1088, honest-connection-states contract from
 * #800).
 *
 * ComposioToolkitPicker dropped SWR's `error` for the connected-accounts
 * call, so a request-level failure fell back to an empty accounts list and
 * `accountsUnavailable === false` — collapsing every genuinely-connected
 * toolkit into the definitive-and-wrong "not connected" chip. The honest
 * "can't check right now" copy already existed in the component but was
 * unreachable on a request failure.
 *
 * BT-1088-001: connected-accounts fetch errors -> chip says "can't check
 *              right now", never "not connected".
 * BT-1088-002: connected-accounts fetch succeeds with zero accounts -> the
 *              genuine empty state still says "not connected", so the two
 *              states stay distinguishable.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
let swrErrors: Record<string, unknown> = {};

mock.module("swr", () => ({
  default: (key: string) => ({
    data: swrResponses[key],
    error: swrErrors[key],
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

describe("ComposioToolkitPicker — failed connected-accounts fetch (#1088)", () => {
  test("BT-1088-001: a failed connected-accounts fetch renders 'can't check right now', not 'not connected'", async () => {
    swrResponses = { "/api/composio/toolkits": { toolkits: [SLACK] } };
    swrErrors = {
      "/api/composio/connected-accounts": new Error(
        "Failed to load /api/composio/connected-accounts",
      ),
    };

    const { ComposioToolkitPicker } = await modulePromise;
    const html = renderToStaticMarkup(
      <ComposioToolkitPicker selectedSlugs={["slack"]} onChange={() => {}} />,
    );

    expect(html).toContain("can&#x27;t check right now");
    expect(html).not.toContain("not connected");
  });

  test("BT-1088-002: a successful fetch with zero accounts still renders the genuine 'not connected' empty state", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {};

    const { ComposioToolkitPicker } = await modulePromise;
    const html = renderToStaticMarkup(
      <ComposioToolkitPicker selectedSlugs={["slack"]} onChange={() => {}} />,
    );

    expect(html).toContain("not connected");
    expect(html).not.toContain("can&#x27;t check right now");
  });
});
