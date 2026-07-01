/**
 * Tests for the shared Composio hooks (TASK-736 B1).
 *
 * useComposioCatalog() has no internal React state (it only derives from
 * SWR), so — matching this repo's existing convention for hooks that wrap a
 * mocked "swr" module (see hooks/use-repo-defaults.test.ts) — it is called
 * directly as a plain function with `swr` mocked out.
 *
 * useComposioConnect() does hold internal state (connectingSlug), which
 * requires a real render pass to use (React hooks cannot be called outside
 * a component). It is exercised via a tiny renderToStaticMarkup harness that
 * captures the hook's returned `connect` function, which is then invoked
 * directly and its side effects (fetch call, window.open, toast, mutate)
 * are asserted.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";

// ── SWR mock state ──────────────────────────────────────────────────────────

type SwrState = {
  toolkits?: ComposioToolkitsResponse;
  toolkitsLoading?: boolean;
  accounts?: ComposioConnectedAccountsResponse;
};

let swrState: SwrState = {};
const swrKeysSeen: unknown[] = [];
let mutateCalls: string[] = [];

mock.module("swr", () => ({
  default: (key: unknown) => {
    swrKeysSeen.push(key);
    if (key === "/api/composio/toolkits") {
      return {
        data: swrState.toolkits,
        isLoading: swrState.toolkitsLoading ?? false,
        mutate: async () => {
          mutateCalls.push(String(key));
        },
      };
    }
    if (key === "/api/composio/connected-accounts") {
      return {
        data: swrState.accounts,
        isLoading: false,
        mutate: async () => {
          mutateCalls.push(String(key));
        },
      };
    }
    return { data: undefined, isLoading: false, mutate: async () => undefined };
  },
  mutate: async (key: unknown) => {
    mutateCalls.push(`global:${String(key)}`);
  },
}));

// ── toast mock ──────────────────────────────────────────────────────────────

const toastCalls: { level: "success" | "error"; message: string }[] = [];
mock.module("sonner", () => ({
  toast: {
    success: (message: string) => {
      toastCalls.push({ level: "success", message });
    },
    error: (message: string) => {
      toastCalls.push({ level: "error", message });
    },
  },
}));

// ── Lazy-import after mocks are wired ────────────────────────────────────────

const modulePromise = import("./composio-shared-hooks");

const SAMPLE_TOOLKITS: ComposioToolkitsResponse = {
  toolkits: [
    {
      slug: "gmail",
      name: "Gmail",
      description: "Send and receive emails.",
      logo: "https://logos.composio.dev/gmail.png",
      categories: ["Communication"],
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

describe("useComposioCatalog", () => {
  beforeEach(() => {
    swrState = {};
    swrKeysSeen.length = 0;
    mutateCalls = [];
  });

  test("BT-B1-01: returns toolkits from the toolkits SWR key", async () => {
    swrState = { toolkits: SAMPLE_TOOLKITS };
    const { useComposioCatalog } = await modulePromise;
    const result = useComposioCatalog();
    expect(result.toolkits).toEqual(SAMPLE_TOOLKITS.toolkits);
  });

  test("BT-B1-02: derives connectedSlugs as a Set from the accounts SWR key", async () => {
    swrState = { accounts: SAMPLE_ACCOUNTS };
    const { useComposioCatalog } = await modulePromise;
    const result = useComposioCatalog();
    expect(result.connectedSlugs).toEqual(new Set(["slack"]));
  });

  test("BT-B1-03: uses the exact cache keys required for cross-component mutate propagation", async () => {
    swrState = {};
    const { useComposioCatalog } = await modulePromise;
    useComposioCatalog();
    expect(swrKeysSeen).toContain("/api/composio/toolkits");
    expect(swrKeysSeen).toContain("/api/composio/connected-accounts");
  });

  test("BT-B1-04: toolkitsLoading reflects the toolkits SWR isLoading state", async () => {
    swrState = { toolkitsLoading: true };
    const { useComposioCatalog } = await modulePromise;
    const result = useComposioCatalog();
    expect(result.toolkitsLoading).toBe(true);
  });
});

describe("useComposioConnect", () => {
  beforeEach(() => {
    swrState = {};
    mutateCalls = [];
    toastCalls.length = 0;
  });

  async function renderConnect(): Promise<
    import("./composio-shared-hooks").ComposioConnectResult
  > {
    const { useComposioConnect } = await modulePromise;
    let captured!: import("./composio-shared-hooks").ComposioConnectResult;
    function Harness() {
      captured = useComposioConnect();
      return null;
    }
    renderToStaticMarkup(<Harness />);
    return captured;
  }

  test("BT-B1-05: connect() POSTs to /api/composio/connect with the toolkit slug", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ redirectUrl: "https://composio.dev/oauth/abc" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    globalThis.window = {
      ...globalThis.window,
      open: mock(() => null),
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("gmail");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/composio/connect");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      toolkitSlug: "gmail",
    });
  });

  test("BT-B1-06: connect() opens the returned redirectUrl in a new tab", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ redirectUrl: "https://composio.dev/oauth/xyz" }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const openSpy = mock(() => null);
    globalThis.window = {
      ...globalThis.window,
      open: openSpy,
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("slack");

    expect(openSpy).toHaveBeenCalledWith(
      "https://composio.dev/oauth/xyz",
      "_blank",
    );
  });

  test("BT-B1-07: connect() success toasts and revalidates the shared connected-accounts key", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ redirectUrl: "https://composio.dev/x" }),
          {
            status: 200,
          },
        ),
    ) as unknown as typeof fetch;
    globalThis.window = {
      ...globalThis.window,
      open: mock(() => null),
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("notion");

    expect(toastCalls).toEqual([
      {
        level: "success",
        message: "Finish connecting in the new tab, then refresh",
      },
    ]);
    expect(mutateCalls).toContain("global:/api/composio/connected-accounts");
  });

  test("BT-B1-08: connect() failure (non-ok response) toasts an error and never opens a tab", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "Toolkit not found" }), {
          status: 400,
        }),
    ) as unknown as typeof fetch;
    const openSpy = mock(() => null);
    globalThis.window = {
      ...globalThis.window,
      open: openSpy,
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("bad-slug");

    expect(openSpy).not.toHaveBeenCalled();
    expect(toastCalls).toEqual([
      { level: "error", message: "Toolkit not found" },
    ]);
  });

  // ── Regression tests ───────────────────────────────────────────────────────
  // These pin behaviors that would silently break the cross-component cache
  // propagation the task explicitly calls out as a risk: "SWR cache keys must
  // stay exactly '/api/composio/toolkits' and '/api/composio/connected-accounts'
  // so mutate propagates across components."

  test("regression: connect() never revalidates the connected-accounts cache on failure", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    ) as unknown as typeof fetch;
    globalThis.window = {
      ...globalThis.window,
      open: mock(() => null),
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("gmail");

    // If a future edit moved the mutateAccounts() call outside the try block
    // (or ahead of the res.ok check), this would start firing on error paths
    // too, causing every consumer of useComposioCatalog() to spuriously
    // revalidate on a failed connect attempt.
    expect(mutateCalls).toEqual([]);
  });

  test("regression: useComposioConnect revalidates the exact same key useComposioCatalog subscribes to", async () => {
    const { COMPOSIO_CONNECTED_ACCOUNTS_KEY } = await modulePromise;
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ redirectUrl: "https://composio.dev/y" }),
          {
            status: 200,
          },
        ),
    ) as unknown as typeof fetch;
    globalThis.window = {
      ...globalThis.window,
      open: mock(() => null),
    } as unknown as Window & typeof globalThis;

    const { connect } = await renderConnect();
    await connect("linear");

    // Pins the literal key string: if useComposioConnect's revalidation
    // target ever drifts from the constant useComposioCatalog subscribes
    // with, connecting a tool would stop updating the picker/catalog's
    // connectedSlugs across components without any type error to catch it.
    expect(mutateCalls).toContain(`global:${COMPOSIO_CONNECTED_ACCOUNTS_KEY}`);
    expect(COMPOSIO_CONNECTED_ACCOUNTS_KEY).toBe(
      "/api/composio/connected-accounts",
    );
  });
});

describe("regression: jsonFetcher error shape is preserved across the extraction", () => {
  test("throws the exact 'Failed to load <url>' message on a non-ok response, matching the two prior duplicated implementations", async () => {
    const { jsonFetcher } = await modulePromise;
    globalThis.fetch = mock(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(jsonFetcher("/api/composio/toolkits")).rejects.toThrow(
      "Failed to load /api/composio/toolkits",
    );
  });
});
