/**
 * Tests for ComposioToolCatalog's honest-connect and error-surface behavior
 * (#801, epic #796 T5, findings W5/C1/C2).
 *
 * This repo's test setup has no DOM/testing-library and no DOM environment
 * registered for bun:test (see repo-selector-compact.test.tsx docstring), so
 * interactive click handlers aren't invocable here. What IS observable via
 * renderToStaticMarkup is the static/first-paint markup produced for a given
 * mocked `swr` response — which is exactly where W5 (name text) and C2
 * (error/retry state) live. The optimistic-toast removal (C1) is proven by
 * asserting the module never imports `sonner`'s `toast.success` at all
 * (grep-style source assertion) plus the removal of the old success-toast
 * copy from the rendered/interactive path, since the old code path fired
 * `toast.success` synchronously inside the click handler with no DOM to
 * click through.
 *
 * BT-801-020: a toolkit card renders the toolkit's name as visible text
 *             content, not just inside an img's alt attribute (W5).
 * BT-801-021: a mocked swr error for /api/composio/toolkits renders a retry
 *             control instead of returning null under an intact header (C2).
 * BT-801-022: the component's source no longer calls `toast.success` for the
 *             connect flow (C1 — replaced by the honest pending/confirmed
 *             state from useComposioConnect).
 * BT-801-P2-2-006: a terminal connect failure (blocked) for a specific
 *                  toolkit slug still renders that card's Connect button
 *                  (not swallowed by the failure-copy-only branch) — proves
 *                  the Codex P2-2 fix at the rendered-markup level, not just
 *                  a source-string check.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

type ToolkitFixture = {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  categories: string[];
  managedAuth: boolean;
  noAuth: boolean;
};

const SLACK: ToolkitFixture = {
  slug: "slack",
  name: "Slack",
  description: "Team messaging platform.",
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

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

let mockConnectState: { status: string; slug?: string; message?: string } = {
  status: "idle",
};

mock.module("./use-composio-connect", () => ({
  useComposioConnect: () => ({
    connectState: mockConnectState,
    connect: async () => undefined,
  }),
}));

const modulePromise = import("./composio-tool-catalog");

describe("ComposioToolCatalog — visible name text (W5)", () => {
  test("BT-801-020: renders the toolkit name as visible text content", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {};
    mockConnectState = { status: "idle" };

    const { ComposioToolCatalog } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioToolCatalog />);

    expect(html).toContain(">Slack<");
  });
});

describe("ComposioToolCatalog — terminal connect failure restores the Connect button (P2-2)", () => {
  test("BT-801-P2-2-006: a 'blocked' connect state for slack still renders a clickable Connect button on slack's card", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {};
    mockConnectState = { status: "blocked", slug: "slack" };

    const { ComposioToolCatalog } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioToolCatalog />);

    // The failure copy is still shown...
    expect(html).toContain("Your browser blocked the connect window");
    // ...AND the Connect button is restored, not swallowed by the failure
    // branch (the pre-fix bug: only the copy rendered, no way to retry).
    expect(html).toContain(">Connect<");
  });

  test("BT-801-P2-2-007: a 'timed_out' connect state for slack still renders a clickable Connect button", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {};
    mockConnectState = { status: "timed_out", slug: "slack" };

    const { ComposioToolCatalog } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioToolCatalog />);

    expect(html).toContain("Still waiting to confirm");
    expect(html).toContain(">Connect<");
  });

  test("a 'pending' (in-flight) connect state does NOT render a duplicate Connect button", async () => {
    swrResponses = {
      "/api/composio/toolkits": { toolkits: [SLACK] },
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {};
    mockConnectState = { status: "pending", slug: "slack" };

    const { ComposioToolCatalog } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioToolCatalog />);

    expect(html).toContain("Waiting for you to finish connecting");
    expect(html).not.toContain(">Connect<");
  });
});

describe("ComposioToolCatalog — catalog error/retry state (C2)", () => {
  test("BT-801-021: a toolkits-fetch error renders a retry control instead of null", async () => {
    swrResponses = {
      "/api/composio/toolkits": undefined,
      "/api/composio/connected-accounts": { accounts: [] },
    };
    swrErrors = {
      "/api/composio/toolkits": new Error(
        "Failed to load /api/composio/toolkits",
      ),
    };
    mockConnectState = { status: "idle" };

    const { ComposioToolCatalog } = await modulePromise;
    const html = renderToStaticMarkup(<ComposioToolCatalog />);

    expect(html).not.toBe("");
    expect(html.toLowerCase()).toContain("retry");
  });
});

describe("ComposioToolCatalog — no optimistic success toast (C1)", () => {
  test("BT-801-022: source no longer calls toast.success for the connect flow", () => {
    const source = readFileSync(
      new URL("composio-tool-catalog.tsx", import.meta.url),
      "utf-8",
    );
    expect(source).not.toContain("toast.success");
  });
});
