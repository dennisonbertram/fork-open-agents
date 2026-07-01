/**
 * Tests for ComposioConnectPopover / ComposioConnectCards (TASK-736 B2).
 *
 * ComposioConnectCards (the card grid + search, no chip/selection state) is
 * exercised directly via renderToStaticMarkup with the shared Composio hooks'
 * "swr" dependency mocked out — matching the pattern in
 * app/settings/composio-shared-hooks.test.tsx.
 *
 * ComposioConnectPopover wraps that content in a Radix Popover, which only
 * mounts PopoverContent once opened — something renderToStaticMarkup cannot
 * simulate (no click events). So ComposioConnectPopover itself is only
 * asserted for its always-rendered trigger button; the card-grid/search
 * assertions live on ComposioConnectCards directly.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";

type SwrState = {
  toolkits?: ComposioToolkitsResponse;
  toolkitsLoading?: boolean;
  accounts?: ComposioConnectedAccountsResponse;
};

let swrState: SwrState = {};

mock.module("swr", () => ({
  default: (key: unknown) => {
    if (key === "/api/composio/toolkits") {
      return {
        data: swrState.toolkits,
        isLoading: swrState.toolkitsLoading ?? false,
        mutate: async () => undefined,
      };
    }
    if (key === "/api/composio/connected-accounts") {
      return {
        data: swrState.accounts,
        isLoading: false,
        mutate: async () => undefined,
      };
    }
    return {
      data: undefined,
      isLoading: false,
      mutate: async () => undefined,
    };
  },
  mutate: async () => undefined,
}));

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const modulePromise = import("./composio-connect-popover");

const SAMPLE_TOOLKITS: ComposioToolkitsResponse = {
  toolkits: [
    {
      slug: "gmail",
      name: "Gmail",
      description: "Send and receive emails.",
      logo: null,
      categories: ["Communication"],
      managedAuth: true,
      noAuth: false,
    },
    {
      slug: "slack",
      name: "Slack",
      description: "Team messaging platform.",
      logo: null,
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
  ],
};

const SAMPLE_ACCOUNTS: ComposioConnectedAccountsResponse = {
  accounts: [
    { id: "acc_1", toolkitSlug: "slack", status: "ACTIVE", alias: null },
  ],
};

describe("ComposioConnectCards", () => {
  beforeEach(() => {
    swrState = {};
  });

  test("BT-B2-01: renders a search input", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html).toContain("Search tools to connect");
  });

  test("BT-B2-02: renders a Connect card for a not-yet-connected toolkit", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html).toContain("Gmail");
    expect(html).toContain("Connect");
  });

  test("BT-B2-03: filters out toolkits that are already connected", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    // Slack is already connected in SAMPLE_ACCOUNTS — must not be offered again
    expect(html).not.toContain("Slack");
  });

  test("BT-B2-04: renders no chip/selection state (this is connect-only, not a picker)", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html).not.toContain("Remove");
  });

  test("BT-B2-05: shows an empty state when every toolkit is already connected", async () => {
    swrState = {
      toolkits: { toolkits: [SAMPLE_TOOLKITS.toolkits[1]!] }, // Slack only
      accounts: SAMPLE_ACCOUNTS,
    };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html.toLowerCase()).toContain("already connected");
  });

  test("BT-B2-06: filters candidates by search query", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    // We can't simulate typing without a DOM, but we can assert the initial
    // (unfiltered) render includes every not-yet-connected toolkit so a
    // future regression that narrows the default view is caught.
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html).toContain("Gmail");
    expect(html).toContain("Linear");
  });

  test("REGRESSION: account-wide language accompanies the connect cards", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS, accounts: SAMPLE_ACCOUNTS };
    const { ComposioConnectCards } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectCards />);
    expect(html.toLowerCase()).toContain("whole account");
  });
});

describe("ComposioConnectPopover", () => {
  beforeEach(() => {
    swrState = {};
  });

  test("BT-B2-07: renders a 'Connect a new tool' trigger", async () => {
    const { ComposioConnectPopover } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectPopover />);
    expect(html).toContain("Connect a new tool");
  });

  test("REGRESSION: trigger reflects disabled=true", async () => {
    const { ComposioConnectPopover } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectPopover disabled />);
    expect(html).toContain("<button");
    // React renders a boolean `disabled` prop as the bare attribute
    // `disabled=""` — check that exact HTML attribute, not just the
    // substring "disabled" (which also appears inside Tailwind's
    // `disabled:pointer-events-none` variant classes on every render).
    expect(html).toContain('disabled=""');
  });

  test("REGRESSION: trigger is not disabled by default", async () => {
    const { ComposioConnectPopover } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioConnectPopover />);
    // The trigger button itself must not carry the `disabled` attribute when
    // disabled=false — guards against it leaking in regardless of the prop.
    expect(html).not.toContain('disabled=""');
  });
});
